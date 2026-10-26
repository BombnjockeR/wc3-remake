/* Room-code multiplayer, peer to peer (WebRTC data channels via PeerJS; its free public broker only
 * introduces the browsers to each other, nothing is stored and there is no game server).
 *
 * Lockstep with the host as the clock: every player runs the same deterministic simulation.
 *  - The host steps the world and, for every tick, broadcasts the list of commands it applied.
 *  - Clients never apply their own commands directly: they send them to the host, which puts them
 *    into the next tick. Clients step exactly the ticks they receive, in order.
 *  - Every 50 ticks the host also sends a hash of the game state; clients compare and report a desync.
 */
(function () {
  'use strict';
  const PREFIX = 'pyrotd-0-31-';
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const makeCode = () => Array.from({ length: 5 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');

  function peerOptions() { // ?peer=host:port[/path] to use your own PeerJS server (e.g. for local tests)
    const m = /[?&]peer=([^&]+)/.exec(location.search); if (!m) return { debug: 0 };
    const [hp, ...path] = decodeURIComponent(m[1]).split('/'); const [host, port] = hp.split(':');
    return { host, port: +port || 9000, path: '/' + path.join('/'), secure: location.protocol === 'https:', debug: 0 };
  }
  function stateHash(w) { // cheap fingerprint of the simulation (FNV-1a)
    let h = 0x811c9dc5;
    const mix = (n) => { n = n | 0; for (let i = 0; i < 4; i++) { h ^= (n >>> (i * 8)) & 255; h = Math.imul(h, 16777619); } };
    mix(w.tick); mix(w.units.length);
    for (const u of w.units) { mix(u.id); mix(Math.round(u.x * 4)); mix(Math.round(u.y * 4)); mix(Math.round(u.hp * 16)); }
    for (const p of w.players) mix(Math.round(p.gold * 16));
    return h >>> 0;
  }

  const Net = {
    role: null, code: '', peer: null, name: 'Player', conns: new Map(), host: null,
    lobby: null, // {slots:[{id, kind:'human'|'open'|'ai'|'closed', name, peer}]}
    onLobby: null, onStart: null, onStatus: null, onChat: null,
    buffer: [], hostSpeed: 1, hostPaused: false, desync: null,
    status(s) { if (this.onStatus) this.onStatus(s); },
    available() { return typeof window.Peer === 'function'; },

    // ---------------------------------------------------------------- host
    hostGame(name, slots) {
      this.close(); this.role = 'host'; this.name = name; this.code = makeCode();
      this.lobby = { slots: slots.map(s => Object.assign({}, s)) };
      const me = this.lobby.slots.find(s => s.kind === 'human'); if (me) { me.name = name; me.peer = 'host'; }
      this.peer = new window.Peer(PREFIX + this.code, peerOptions());
      this.peer.on('open', () => { this.status(`Room ${this.code} is open. Share the code with your friends.`); this.pushLobby(); });
      this.peer.on('error', (e) => { if (e.type === 'unavailable-id') { this.hostGame(name, slots); return; } this.status('Network error: ' + (e.type || e.message)); });
      this.peer.on('connection', (conn) => this.accept(conn));
      return this.code;
    },
    accept(conn) {
      conn.on('open', () => { this.conns.set(conn.peer, { conn, name: 'Player', pid: null }); });
      conn.on('data', (m) => this.hostReceive(conn, m));
      conn.on('close', () => this.dropClient(conn.peer));
      conn.on('error', () => this.dropClient(conn.peer));
    },
    hostReceive(conn, m) {
      const c = this.conns.get(conn.peer); if (!c || !m) return;
      if (m.t === 'hello') {
        if (this.started) { conn.send({ t: 'full', why: 'The game has already started.' }); return; }
        c.name = String(m.name || 'Player').slice(0, 20);
        const slot = this.lobby.slots.find(s => s.kind === 'open');
        if (!slot) { conn.send({ t: 'full', why: 'The room is full.' }); return; }
        slot.kind = 'human'; slot.name = c.name; slot.peer = conn.peer; c.pid = slot.id;
        this.status(`${c.name} joined.`); this.pushLobby();
      } else if (m.t === 'slot' && !this.started) { // move to another open slot
        const to = this.lobby.slots.find(s => s.id === m.id && s.kind === 'open'); const from = this.lobby.slots.find(s => s.peer === conn.peer);
        if (to && from) { to.kind = 'human'; to.name = from.name; to.peer = from.peer; from.kind = 'open'; from.name = ''; from.peer = null; c.pid = to.id; this.pushLobby(); }
      } else if (m.t === 'cmd' && this.started && this.world && c.pid != null) {
        const cmd = m.c || {}; cmd.pid = c.pid; this.world.queue.push(cmd); // the host decides which player a command belongs to
      }
    },
    dropClient(peerId) {
      const c = this.conns.get(peerId); if (!c) return; this.conns.delete(peerId);
      const slot = this.lobby && this.lobby.slots.find(s => s.peer === peerId);
      if (!this.started) { if (slot) { slot.kind = 'open'; slot.name = ''; slot.peer = null; } this.pushLobby(); this.status(`${c.name} left.`); }
      else if (this.world && c.pid != null) this.world.queue.push({ pid: c.pid, type: 'leave' });
    },
    setSlotKind(id, kind) {
      const s = this.lobby.slots.find(x => x.id === id); if (!s || s.kind === 'human') return;
      s.kind = kind; s.name = ''; this.pushLobby();
    },
    pushLobby() {
      if (this.onLobby) this.onLobby(this.lobby);
      for (const c of this.conns.values()) if (c.conn.open) c.conn.send({ t: 'lobby', lobby: this.lobby, you: c.pid, code: this.code });
    },
    startAsHost(cfg) { // cfg is the same for everyone except "me"
      this.started = true;
      for (const c of this.conns.values()) if (c.conn.open && c.pid != null) c.conn.send({ t: 'start', cfg: Object.assign({}, cfg, { me: c.pid }) });
    },
    // called by the game loop after every host tick
    hostTicks(batch, firstTick, speed, paused) {
      if (!this.conns.size) return;
      const msg = { t: 'k', n: firstTick, c: batch, sp: speed, p: paused ? 1 : 0 };
      const w = this.world; if (w && w.tick % 50 < batch.length) msg.h = { n: w.tick - (w.tick % 50), v: this.lastHash };
      for (const c of this.conns.values()) if (c.conn.open) c.conn.send(msg);
    },
    noteHash(w) { if (w.tick % 50 === 0) this.lastHash = stateHash(w); },

    // ---------------------------------------------------------------- client
    join(code, name) {
      this.close(); this.role = 'client'; this.name = name; this.code = String(code || '').trim().toUpperCase();
      this.peer = new window.Peer(undefined, peerOptions());
      this.peer.on('open', () => {
        this.status(`Connecting to room ${this.code}...`);
        const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' }); this.host = conn;
        conn.on('open', () => { this.status('Connected. Waiting for the host to start.'); conn.send({ t: 'hello', name }); });
        conn.on('data', (m) => this.clientReceive(m));
        conn.on('close', () => { this.status('The host closed the room.'); if (this.onHostLost) this.onHostLost(); });
        conn.on('error', (e) => this.status('Connection error: ' + (e.message || e)));
      });
      this.peer.on('error', (e) => this.status(e.type === 'peer-unavailable' ? `Room ${this.code} not found.` : 'Network error: ' + (e.type || e.message)));
    },
    clientReceive(m) {
      if (!m) return;
      if (m.t === 'lobby') { this.lobby = m.lobby; this.myPid = m.you; if (this.onLobby) this.onLobby(m.lobby, m.you); }
      else if (m.t === 'full') this.status(m.why);
      else if (m.t === 'start') { this.started = true; this.buffer = []; this.desync = null; if (this.onStart) this.onStart(m.cfg); }
      else if (m.t === 'k') {
        m.c.forEach((cmds, i) => this.buffer.push({ n: m.n + i, c: cmds }));
        this.hostSpeed = m.sp || 1; this.hostPaused = !!m.p;
        if (m.h) (this.hashes = this.hashes || []).push(m.h);
      }
    },
    sendCmd(c) { if (this.host && this.host.open) this.host.send({ t: 'cmd', c }); },
    // client side: step the world through every tick that has arrived (with smoothing)
    clientStep(w, dt) {
      let n = 0;
      this.acc = (this.acc || 0) + dt * this.hostSpeed;
      const behind = this.buffer.length;
      while (this.buffer.length && (this.acc >= window.Pyro.DT || behind > 6) && n < 400) {
        const k = this.buffer.shift();
        w.queue = k.c.map(c => Object.assign({}, c)); w.step(); n++; this.acc = Math.max(0, this.acc - window.Pyro.DT);
        if (w.tick % 50 === 0 && this.hashes) {
          const h = this.hashes.find(x => x.n === w.tick);
          if (h && h.v !== undefined && h.v !== stateHash(w) && !this.desync) { this.desync = w.tick; if (this.onDesync) this.onDesync(w.tick); }
          this.hashes = this.hashes.filter(x => x.n > w.tick);
        }
      }
      if (!this.buffer.length) this.acc = Math.min(this.acc, window.Pyro.DT);
      return { steps: n, alpha: Math.min(1, this.acc / window.Pyro.DT) };
    },
    close() {
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
      this.peer = null; this.conns = new Map(); this.host = null; this.role = null; this.started = false; this.world = null; this.buffer = []; this.hashes = [];
    },
    stateHash,
  };
  window.PyroNet = Net;
})();
