/* Pyro TD web port - simulation engine.
 * A small Warcraft-3-like simulation: units, attacks, armor/damage tables, auras, buffs, techs,
 * movement and pathing. Game-specific rules live in rules.js and hook in via events.
 * The simulation is deterministic (seeded RNG, fixed time step) so it can later run in lockstep
 * multiplayer: every player action must go through World.command().
 */
(function () {
  'use strict';
  const D = window.PYRO_DATA;
  const DT = 0.05; // 20 simulation ticks per second

  // Player slots follow the original map: 0 = Team 1 computer (red castle), 1 = Team 2 computer (blue castle),
  // 2-5 = Team 1 players, 6-9 = Team 2 players.
  const TEAM_OF = [0, 1, 0, 0, 0, 0, 1, 1, 1, 1];
  const PLAYER_COLORS = ['#ff0303', '#0042ff', '#1ce6b9', '#540081', '#fffc00', '#fe8a0e', '#20c000', '#e55bb0', '#959697', '#7ebff1'];
  const PLAYER_NAMES = ['Team 1 (Castle)', 'Team 2 (Castle)', 'Player 3', 'Player 4', 'Player 5', 'Player 6', 'Player 7', 'Player 8', 'Player 9', 'Player 10'];

  class RNG {
    constructor(seed) { this.s = seed >>> 0; }
    next() {
      let t = (this.s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
    pick(arr) { return arr.length ? arr[Math.floor(this.next() * arr.length)] : null; }
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rectCenter = (r) => ({ x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2 });
  const inRect = (r, x, y) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

  // ------------------------------------------------------------------ pathing grid
  class Grid {
    constructor(geo) {
      const p = geo.path;
      this.w = p.w; this.h = p.h; this.minX = p.minX; this.minY = p.minY; this.cell = p.cell;
      this.flags = new Uint8Array(this.w * this.h);
      for (let i = 0; i < this.w * this.h; i++) this.flags[i] = parseInt(p.data.substr(i * 2, 2), 16);
      this.occ = new Int32Array(this.w * this.h); // id of structure occupying the cell
      // trees block walking and building
      for (const [tx, ty] of geo.trees) this.markRect(tx - 48, ty - 48, tx + 48, ty + 48, 0x0A);
    }
    cx(x) { return Math.floor((x - this.minX) / this.cell); }
    cy(y) { return Math.floor((y - this.minY) / this.cell); }
    idx(cx, cy) { return (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) ? -1 : cy * this.w + cx; }
    markRect(x0, y0, x1, y1, flag) {
      for (let cy = this.cy(y0); cy <= this.cy(y1 - 1); cy++)
        for (let cx = this.cx(x0); cx <= this.cx(x1 - 1); cx++) {
          const i = this.idx(cx, cy); if (i >= 0) this.flags[i] |= flag;
        }
    }
    walkable(x, y) {
      const i = this.idx(this.cx(x), this.cy(y));
      if (i < 0) return false;
      return !(this.flags[i] & 2) && !this.occ[i];
    }
    walkableCell(cx, cy) {
      const i = this.idx(cx, cy);
      return i >= 0 && !(this.flags[i] & 2) && !this.occ[i];
    }
    buildableCell(cx, cy) {
      const i = this.idx(cx, cy);
      return i >= 0 && !(this.flags[i] & 0x0A) && !this.occ[i];
    }
    // footprint of a 4x4 tower centred on (x,y); returns null if not placeable
    footprint(x, y, size) {
      const half = size * this.cell / 2;
      const cx0 = this.cx(x - half + 1), cy0 = this.cy(y - half + 1);
      const cells = [];
      for (let cy = cy0; cy < cy0 + size; cy++)
        for (let cx = cx0; cx < cx0 + size; cx++) cells.push([cx, cy]);
      return cells;
    }
    canPlace(x, y, size) {
      return this.footprint(x, y, size).every(([cx, cy]) => this.buildableCell(cx, cy));
    }
    occupy(x, y, size, id) {
      for (const [cx, cy] of this.footprint(x, y, size)) {
        const i = this.idx(cx, cy); if (i >= 0) this.occ[i] = id;
      }
    }
    // straight line walkability test (sampled every 16 units)
    lineClear(ax, ay, bx, by) {
      const d = Math.hypot(bx - ax, by - ay); const n = Math.ceil(d / 16);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        if (!this.walkable(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
      }
      return true;
    }
    // A* on the 32x32 grid; returns list of world points
    findPath(ax, ay, bx, by) {
      const sx = this.cx(ax), sy = this.cy(ay); let gx = this.cx(bx), gy = this.cy(by);
      if (!this.walkableCell(gx, gy)) {
        // pick nearest walkable goal cell
        let best = null;
        for (let r = 1; r < 12 && !best; r++)
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
            if (!best && this.walkableCell(gx + dx, gy + dy)) best = [gx + dx, gy + dy];
        if (!best) return null; [gx, gy] = best;
      }
      const W = this.w; const start = sy * W + sx, goal = gy * W + gx;
      const g = new Map([[start, 0]]); const came = new Map();
      const open = [[Math.hypot(gx - sx, gy - sy), start]];
      const closed = new Set(); let iter = 0;
      while (open.length && iter++ < 20000) {
        let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
        const [, cur] = open.splice(bi, 1)[0];
        if (cur === goal) break;
        if (closed.has(cur)) continue; closed.add(cur);
        const cx = cur % W, cy = (cur / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.walkableCell(nx, ny)) continue;
          if (dx && dy && (!this.walkableCell(cx + dx, cy) || !this.walkableCell(cx, cy + dy))) continue;
          const ni = ny * W + nx; const ng = g.get(cur) + (dx && dy ? 1.414 : 1);
          if (ng < (g.has(ni) ? g.get(ni) : Infinity)) {
            g.set(ni, ng); came.set(ni, cur); open.push([ng + Math.hypot(gx - nx, gy - ny), ni]);
          }
        }
      }
      if (!came.has(goal)) return null;
      const pts = []; let c = goal;
      while (c !== start) { pts.push({ x: this.minX + (c % W + 0.5) * this.cell, y: this.minY + (((c / W) | 0) + 0.5) * this.cell }); c = came.get(c); }
      pts.reverse();
      // string-pull to remove redundant points
      const out = []; let from = { x: ax, y: ay };
      for (let i = 0; i < pts.length; i++) {
        const nxt = pts[i + 1];
        if (nxt && this.lineClear(from.x, from.y, nxt.x, nxt.y)) continue;
        out.push(pts[i]); from = pts[i];
      }
      out.push({ x: bx, y: by });
      return out;
    }
  }

  // ------------------------------------------------------------------ units
  let UID = 1;
  class Unit {
    constructor(world, typeId, owner, x, y) {
      const def = D.units[typeId];
      if (!def) throw new Error('Unknown unit type ' + typeId);
      this.world = world; this.id = UID++; this.typeId = typeId; this.def = def; this.owner = owner;
      this.x = x; this.y = y; this.facing = 270;
      this.baseArmor = def.armor; this.baseDmg = def.dmg;
      this.hp = 1; this.dead = false; this.removed = false;
      this.structure = def.structure; this.collision = def.collision; this.flying = def.moveType === 'fly';
      this.invulnerable = def.abil.includes('Avul');
      this.userData = 0; this.abil = {}; this.buffs = []; this.cooldowns = {};
      for (const a of def.abil) this.abil[a] = 1;
      this.order = { type: 'idle' }; this.target = null; this.atkReady = 0; this.swing = null;
      this.moveSpeedOverride = null; this.path = null; this.holdAttack = false;
      this.aura = { armor: 0, ias: 0, move: 0, regen: 0 }; this.lastAcquire = 0;
      this.timedLife = null; this.building = null; this.flags = {};
      this.hp = this.maxHp();
    }
    get team() { return TEAM_OF[this.owner]; }
    techLevel(t) { return this.world.players[this.owner].techs[t] || 0; }
    maxHp() {
      let hp = this.def.hp;
      for (const t of this.def.techs) {
        const lvl = this.techLevel(t); if (!lvl) continue;
        for (const e of (D.techs[t] || { effects: [] }).effects) if (e.code === 'rhpx') hp += e.base + e.mod * (lvl - 1);
      }
      return Math.max(1, hp);
    }
    dmgBonus() { // 'ratt' = apply the unit's damage-upgrade value once per level per effect
      let b = 0;
      for (const t of this.def.techs) {
        const lvl = this.techLevel(t); if (!lvl) continue;
        for (const e of (D.techs[t] || { effects: [] }).effects) if (e.code === 'ratt') b += this.def.dmgUp * lvl;
      }
      return b;
    }
    diceBonus() {
      let b = 0;
      for (const t of this.def.techs) {
        const lvl = this.techLevel(t); if (!lvl) continue;
        for (const e of (D.techs[t] || { effects: [] }).effects) if (e.code === 'ratd') b += e.base + e.mod * (lvl - 1);
      }
      return b;
    }
    armor() {
      let a = this.baseArmor + this.aura.armor;
      for (const b of this.buffs) if (b.armor) a += b.armor;
      return a;
    }
    ias() { // increased attack speed
      let s = this.aura.ias;
      for (const b of this.buffs) if (b.ias) s += b.ias;
      return Math.max(-0.8, Math.min(4, s));
    }
    moveSpeed() {
      let base = this.moveSpeedOverride != null ? this.moveSpeedOverride : this.def.speed;
      let f = 1 + this.aura.move;
      for (const b of this.buffs) if (b.move) f += b.move;
      return Math.max(D.misc.minSpeed, Math.min(D.misc.maxSpeed, base * Math.max(0, f)));
    }
    cooldown() { return this.def.cd / (1 + this.ias()); }
    stunned() { return this.buffs.some(b => b.stun); }
    hasBuff(id) { return this.buffs.some(b => b.id === id); }
    addBuff(b) { // b: {id, dur, ...effects}; same id refreshes
      const w = this.world; const ex = this.buffs.find(x => x.id === b.id);
      if (ex) { Object.assign(ex, b); ex.until = w.time + b.dur; return ex; }
      b.until = w.time + b.dur; this.buffs.push(b); return b;
    }
    removeBuff(id) { this.buffs = this.buffs.filter(b => b.id !== id); }
    alive() { return !this.dead && !this.removed; }
    lifePct() { return this.hp / this.maxHp() * 100; }
    hasWeapon() { return this.def.weaponsOn !== 0 && this.def.weapon !== '_' && this.def.targs.length > 0 && this.def.targs[0] !== '_'; }
  }

  // ------------------------------------------------------------------ world
  class World {
    constructor(opts) {
      this.opts = opts || {};
      this.rng = new RNG(this.opts.seed || 12345);
      this.time = 0; this.tick = 0;
      this.units = []; this.byId = new Map();
      this.grid = new Grid(D.geo);
      this.regions = D.geo.regions;
      this.players = [];
      for (let i = 0; i < 10; i++)
        this.players.push({ id: i, team: TEAM_OF[i], gold: 0, techs: {}, name: PLAYER_NAMES[i], color: PLAYER_COLORS[i],
          kind: i < 2 ? 'castle' : 'empty', playing: i < 2 });
      this.handlers = {}; this.timers = []; this.projectiles = []; this.effects = []; this.messages = [];
      this.queue = []; // commands waiting to be applied (multiplayer-ready)
      this.over = null; this.paused = false;
    }
    // -------- events
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
    emit(ev, ...args) { for (const fn of this.handlers[ev] || []) fn(...args); }
    // -------- timers (simulation time)
    after(sec, fn) { const t = { at: this.time + sec, fn, every: 0, dead: false }; this.timers.push(t); return t; }
    every(sec, fn, first) { const t = { at: this.time + (first != null ? first : sec), fn, every: sec, dead: false }; this.timers.push(t); return t; }
    cancel(t) { if (t) t.dead = true; }
    // -------- messages
    msg(text, players, dur) {
      this.messages.push({ text, players: players || null, at: this.time, dur: dur || 10 });
      if (this.messages.length > 200) this.messages.shift();
    }
    // -------- players
    ally(a, b) { return TEAM_OF[a] === TEAM_OF[b]; }
    enemy(a, b) { return TEAM_OF[a] !== TEAM_OF[b]; }
    teamPlayers(team, onlyPlaying = true) {
      return this.players.filter(p => p.team === team && p.id >= 2 && (!onlyPlaying || p.playing));
    }
    addGold(pid, n) { this.players[pid].gold = Math.max(0, this.players[pid].gold + n); }
    setTech(pid, tech, lvl) {
      const p = this.players[pid]; const before = p.techs[tech] || 0; if (before === lvl) return;
      const affected = this.units.filter(u => u.owner === pid && u.alive() && u.def.techs.includes(tech));
      const pct = affected.map(u => u.hp / u.maxHp());
      p.techs[tech] = lvl;
      // like WC3, a max-HP upgrade keeps the unit's life percentage
      affected.forEach((u, i) => { u.hp = Math.max(1, pct[i] * u.maxHp()); });
    }
    // -------- units
    createUnit(typeId, owner, x, y, opts = {}) {
      const u = new Unit(this, typeId, owner, x, y);
      if (opts.facing != null) u.facing = opts.facing;
      this.units.push(u); this.byId.set(u.id, u);
      if (u.structure && !opts.noFootprint) {
        const size = opts.size || (u.collision > 100 ? 8 : 4);
        u.footprintSize = size; this.grid.occupy(x, y, size, u.id);
      }
      this.emit('create', u);
      return u;
    }
    removeUnit(u) {
      if (u.removed) return;
      u.removed = true; u.dead = true;
      if (u.structure && u.footprintSize) this.grid.occupy(u.x, u.y, u.footprintSize, 0);
      this.byId.delete(u.id);
    }
    // ReplaceUnitBJ: method 0 = keep life %, 1 = keep absolute life, 2/3 = default (full)
    replaceUnit(u, typeId, method) {
      const pct = u.hp / u.maxHp(); const abs = u.hp;
      const fp = u.footprintSize;
      if (u.structure && fp) this.grid.occupy(u.x, u.y, fp, 0);
      const n = new Unit(this, typeId, u.owner, u.x, u.y);
      n.facing = u.facing; n.order = { type: 'idle' };
      if (method === 0) n.hp = Math.max(1, pct * n.maxHp());
      else if (method === 1) n.hp = Math.max(1, Math.min(n.maxHp(), abs));
      else n.hp = n.maxHp();
      u.removed = true; u.dead = true; this.byId.delete(u.id);
      const i = this.units.indexOf(u); if (i >= 0) this.units[i] = n; else this.units.push(n);
      this.byId.set(n.id, n);
      if (n.structure && fp) { n.footprintSize = fp; this.grid.occupy(n.x, n.y, fp, n.id); }
      this.emit('replaced', u, n);
      return n;
    }
    setLife(u, v) { if (!u.alive()) return; u.hp = Math.max(0, Math.min(u.maxHp(), v)); if (u.hp < 0.405) this.kill(u, null); }
    kill(u, killer) {
      if (u.dead) return;
      // Reincarnation (Tauren): revive after the ability delay instead of dying
      const rl = u.abil['A02W'];
      if (rl && !u.flags.reincarnated) {
        u.flags.reincarnated = true; u.flags.reincarnating = true; u.hp = 0.01; u.target = null; u.swing = null;
        this.effect('reincarnate', u.x, u.y, 2);
        this.emit('reincarnateStart', u);
        this.after(D.abilities.A02W.dataa[rl - 1] || 2, () => {
          if (u.removed) return; u.flags.reincarnating = false; u.hp = u.maxHp(); this.emit('reincarnateEnd', u);
        });
        return;
      }
      u.dead = true; u.hp = 0; u.deathTime = this.time; u.target = null; u.swing = null;
      if (u.structure && u.footprintSize) this.grid.occupy(u.x, u.y, u.footprintSize, 0);
      this.emit('death', u, killer);
    }
    unitsInRange(x, y, r, filter) {
      const out = [];
      for (const u of this.units) {
        if (!u.alive() || u.flags.reincarnating) continue;
        if (Math.hypot(u.x - x, u.y - y) <= r + u.collision && (!filter || filter(u))) out.push(u);
      }
      return out;
    }
    unitsInRect(r, filter) { return this.units.filter(u => u.alive() && !u.flags.reincarnating && inRect(r, u.x, u.y) && (!filter || filter(u))); }
    // -------- targeting rules (WC3 "targets allowed")
    canTarget(a, t, targs) {
      targs = targs || a.def.targs;
      if (!t.alive() || t.flags.reincarnating || t === a) return false;
      if (t.typeId === 'o000' && !targs.includes('ward')) return false;
      const wantsInv = targs.includes('invulnerable'), wantsVul = targs.includes('vulnerable');
      if (t.invulnerable) { if (!wantsInv) return false; } else if (wantsInv && !wantsVul) return false;
      // if no unit-type flags are given (e.g. evolution towers: "invulnerable" only) ground units are allowed
      const typed = targs.some(f => f === 'ground' || f === 'air' || f === 'structure' || f === 'ward' || f === 'debris');
      if (t.structure) { if (!targs.includes('structure')) return false; }
      else if (typed && !targs.includes('ground') && !targs.includes('air')) return false;
      const friendOk = targs.includes('friend') || targs.includes('allies');
      if (this.ally(a.owner, t.owner)) { if (!friendOk) return false; }
      return true;
    }
    // -------- orders
    orderMove(u, x, y) { u.order = { type: 'move', x, y }; u.target = null; u.path = null; }
    orderAttackMove(u, x, y) { u.order = { type: 'amove', x, y }; u.target = null; u.path = null; }
    orderAttack(u, t) { u.order = { type: 'attack', target: t }; u.target = t; u.path = null; }
    orderStop(u) { u.order = { type: 'idle' }; u.target = null; u.path = null; }
    // -------- damage
    // kind: 'attack' (normal attack, uses armor & attack type) or 'spell' (ignores armor value)
    damage(src, t, amount, atkType, kind, opts = {}) {
      if (!t.alive() || t.flags.reincarnating) return 0;
      if (t.invulnerable && !opts.force) return 0;
      if (t.buffs.some(b => b.invuln)) return 0;
      let dmg = amount;
      if (kind === 'attack') {
        // Hardened skin / block (Assk): reduces attack damage before armor, min value
        for (const [id, lvl] of Object.entries(t.abil)) {
          const ab = D.abilities[id]; if (!ab || ab.base !== 'Assk' || !lvl) continue;
          if (src && src.structure && id === 'A00D') continue; // 0.31: Captain-Block no longer works vs buildings
          dmg = Math.max(Math.min(dmg, ab.datab[lvl - 1]), dmg - ab.datac[lvl - 1]);
        }
        const a = t.armor();
        const f = a >= 0 ? 1 - (a * D.misc.armorFactor) / (1 + a * D.misc.armorFactor) : 2 - Math.pow(0.94, -a);
        dmg *= f;
      }
      const table = D.misc.dmg[atkType] || D.misc.dmg.normal;
      dmg *= table[t.def.armorType] != null ? table[t.def.armorType] : 1;
      if (dmg <= 0) return 0;
      // Spirit link: share damage with linked allies
      const link = t.buffs.find(b => b.link);
      if (link && !opts.noLink) {
        const mates = link.link.mates.filter(m => m !== t && m.alive() && m.buffs.some(b => b.link === link.link));
        if (mates.length) {
          const shared = dmg * (1 - link.link.factor);
          dmg -= shared;
          for (const m of mates) this.damage(src, m, shared / mates.length, 'spells', 'spell', { noLink: true, force: false, raw: true });
        }
      }
      t.hp -= dmg;
      this.emit('damaged', t, src, dmg, kind);
      if (t.hp < 0.405) this.kill(t, src);
      return dmg;
    }
    effect(kind, x, y, dur, extra) { this.effects.push(Object.assign({ kind, x, y, at: this.time, dur: dur || 0.6 }, extra || {})); }
    // -------- commands (all player input goes through here)
    command(cmd) { this.queue.push(cmd); }

    // ------------------------------------------------------------------ main step
    step() {
      if (this.over && this.over.final) return;
      const cmds = this.queue; this.queue = [];
      for (const c of cmds) this.emit('command', c);
      this.time += DT; this.tick++;
      // timers
      const due = this.timers.filter(t => !t.dead && t.at <= this.time + 1e-9);
      for (const t of due) {
        if (t.dead) continue;
        if (t.every) t.at += t.every; else t.dead = true;
        t.fn();
      }
      if (this.tick % 40 === 0) this.timers = this.timers.filter(t => !t.dead);
      // buffs expiry & auras every 0.5s
      for (const u of this.units) {
        if (!u.alive()) continue;
        if (u.buffs.length) {
          const before = u.buffs.length;
          u.buffs = u.buffs.filter(b => b.until > this.time);
          if (u.buffs.length !== before) this.emit('buffsChanged', u);
        }
        if (u.timedLife != null && this.time >= u.timedLife) { this.kill(u, null); }
      }
      if (this.tick % 10 === 0) this.updateAuras();
      // regeneration
      const night = this.isNight();
      for (const u of this.units) {
        if (!u.alive() || u.flags.reincarnating) continue;
        let r = u.aura.regen;
        if (u.def.regen > 0 && (u.def.regenType === 'always' || (u.def.regenType === 'night' && night))) r += u.def.regen;
        if (r > 0 && u.hp < u.maxHp()) u.hp = Math.min(u.maxHp(), u.hp + r * DT);
      }
      // construction / upgrades
      for (const u of this.units) {
        if (u.building && u.alive() && this.time >= u.building.until) {
          const b = u.building; u.building = null;
          if (b.kind === 'upgrade') {
            const n = this.replaceUnit(u, b.to, 1);
            n.hp = n.maxHp(); n.userData = u.userData; n.abilKeep = null;
            for (const [k, v] of Object.entries(b.keepAbil || {})) n.abil[k] = v;
            n.holdAttack = u.holdAttack;
            this.emit('upgradeFinish', n, u);
          } else {
            u.hp = u.maxHp(); this.emit('constructFinish', u);
          }
        }
      }
      // units (remember last position for smooth rendering)
      for (const u of this.units) { u.px = u.x; u.py = u.y; u.moving = false; }
      for (const u of this.units) if (u.alive() && !u.flags.reincarnating) this.updateUnit(u);
      this.separate();
      // projectiles
      for (const p of this.projectiles) {
        if (p.done) continue;
        const t = p.target; const tx = t ? t.x : p.tx, ty = t ? t.y : p.ty;
        const d = Math.hypot(tx - p.x, ty - p.y); const step = p.speed * DT;
        if (d <= step) { p.done = true; p.x = tx; p.y = ty; if (p.onHit) p.onHit(); }
        else { p.x += (tx - p.x) / d * step; p.y += (ty - p.y) / d * step; }
      }
      if (this.tick % 20 === 0) {
        this.projectiles = this.projectiles.filter(p => !p.done);
        this.effects = this.effects.filter(e => this.time - e.at < e.dur);
        // corpses disappear after 3 seconds
        const gone = this.units.filter(u => u.dead && !u.removed && this.time - (u.deathTime || 0) > 3);
        gone.forEach(u => { u.removed = true; this.byId.delete(u.id); });
        if (this.tick % 200 === 0) this.units = this.units.filter(u => !u.removed);
      }
      this.emit('tick');
    }
    isNight() { const hour = (8 + this.time / 20) % 24; return hour >= 18 || hour < 6; } // 1 game hour = 20 s
    timeOfDay() { return (8 + this.time / 20) % 24; }

    // ------------------------------------------------------------------ auras
    updateAuras() {
      const live = this.units.filter(u => u.alive() && !u.flags.reincarnating);
      for (const u of live) u.aura = { armor: 0, ias: 0, move: 0, regen: 0, srcs: [] };
      const best = new Map(); // non-stacking auras: key unit.id+auraId -> value
      for (const s of live) {
        if (s.building && s.building.kind === 'construct') continue;
        for (const [id, lvl] of Object.entries(s.abil)) {
          if (!lvl) continue;
          const ab = D.abilities[id]; if (!ab) continue;
          const L = lvl - 1;
          let kind = null;
          if (ab.base === 'AHad' && ab.dataa[L] > 0) kind = 'armor';
          else if (ab.base === 'SCae' && (ab.datab[L] || ab.dataa[L])) kind = 'endurance';
          else if (ab.base === 'Aasl' && ab.dataa[L] < 0) kind = 'slow';
          else if (ab.base === 'Aoar') kind = 'heal';
          if (!kind) continue;
          const area = ab.area[L] || 0;
          const targs = ab.targs;
          const allowSelf = targs.includes('self') || ((targs.includes('friend') || targs.includes('allies')) && !targs.includes('notself'));
          const allowFriend = targs.includes('friend') || targs.includes('allies');
          const allowEnemy = targs.includes('enemy') || targs.includes('enemies');
          const allowInv = targs.includes('invu') || targs.includes('invulnerable');
          for (const t of this.unitsInRange(s.x, s.y, area)) {
            if (t === s) { if (!allowSelf) continue; }
            else if (this.ally(s.owner, t.owner)) { if (!allowFriend) continue; }
            else if (!allowEnemy) continue;
            if (targs.includes('structure') !== t.structure) continue;
            if (t.invulnerable && !allowInv && !t.structure) continue;
            if (t.typeId === 'o000') continue;
            const key = t.id + ':' + (ab.buff || id);
            let val;
            if (kind === 'armor') val = ab.dataa[L];
            else if (kind === 'endurance') val = ab.datab[L];
            else if (kind === 'slow') val = ab.dataa[L];
            else val = ab.dataa[L];
            const prev = best.get(key);
            if (!prev || Math.abs(val) > Math.abs(prev.val)) best.set(key, { t, kind, val, move: kind === 'endurance' ? (ab.dataa[L] || 0) : 0, src: s });
          }
        }
      }
      for (const b of best.values()) {
        const a = b.t.aura;
        if (b.kind === 'armor') a.armor += b.val;
        else if (b.kind === 'endurance') { a.ias += b.val; a.move += b.move; }
        else if (b.kind === 'slow') a.move += b.val;
        else if (b.kind === 'heal') a.regen += b.val;
        a.srcs.push(b.kind);
      }
    }

    // ------------------------------------------------------------------ unit AI / movement / attack
    updateUnit(u) {
      if (u.stunned()) { u.swing = null; return; }
      if (u.building && u.building.kind === 'construct') return;
      // pending attack swing (damage point)
      if (u.swing) {
        if (this.time >= u.swing.at) {
          const sw = u.swing; u.swing = null;
          if (sw.target.alive()) this.launchAttack(u, sw.target, sw.extra);
        } else return;
      }
      const canAttack = u.hasWeapon() && !u.holdAttack && !(u.building && u.building.kind === 'upgrade');
      const o = u.order;
      // validate current target
      if (u.target && (!this.canTarget(u, u.target) || (u.structure && dist(u, u.target) > u.def.range + u.target.collision + 16))) u.target = null;
      if (o.type === 'attack' && (!o.target || !o.target.alive() || !this.canTarget(u, o.target))) { u.order = { type: 'idle' }; u.target = null; }
      // acquire targets
      if (canAttack && !u.target && o.type !== 'move' && this.time - u.lastAcquire >= 0.25) {
        u.lastAcquire = this.time;
        const range = u.structure ? u.def.range : Math.max(u.def.acquire, u.def.range);
        u.target = this.acquire(u, range);
      }
      if (o.type === 'attack') u.target = o.target;
      if (u.target && canAttack) {
        const t = u.target; const d = dist(u, t);
        const reach = u.def.range + t.collision + u.collision * 0.5;
        if (d <= reach) {
          u.facing = Math.atan2(t.y - u.y, t.x - u.x) * 180 / Math.PI;
          if (this.time >= u.atkReady) this.startAttack(u, t);
          return;
        }
        if (!u.structure && u.def.speed > 0) { this.moveToward(u, t.x, t.y, reach - 4); return; }
        u.target = null;
      }
      if ((o.type === 'move' || o.type === 'amove') && u.def.speed > 0) {
        const arrived = this.moveToward(u, o.x, o.y, 6);
        if (arrived) { const prev = o; u.order = { type: 'idle' }; this.emit('arrived', u, prev); }
      }
    }
    acquire(u, range) {
      let best = null, bd = Infinity, bestPrio = -1;
      for (const t of this.units) {
        if (!t.alive() || t.flags.reincarnating || !this.enemy(u.owner, t.owner)) continue;
        if (!this.canTarget(u, t)) continue;
        const d = Math.hypot(t.x - u.x, t.y - u.y) - t.collision;
        if (d > range) continue;
        const prio = t.structure ? 0 : 1; // prefer units over buildings
        if (prio > bestPrio || (prio === bestPrio && d < bd)) { best = t; bd = d; bestPrio = prio; }
      }
      return best;
    }
    startAttack(u, t) {
      u.atkReady = this.time + u.cooldown();
      const ev = { attacker: u, target: t, cancel: false };
      this.emit('attackStart', u, t, ev);
      if (ev.cancel || !u.alive()) return;
      u.swing = { target: t, at: this.time + Math.min(u.def.dmgPt || 0.2, u.cooldown() * 0.9) };
    }
    rollDamage(u) {
      const dice = Math.max(0, u.def.dice + u.diceBonus());
      let d = u.baseDmg + u.dmgBonus();
      for (let i = 0; i < dice; i++) d += u.def.sides > 0 ? this.rng.int(1, u.def.sides) : 0;
      return Math.max(0, d);
    }
    launchAttack(u, t, extra) {
      const targets = [t];
      // Barrage-based multishot (Archer, Naga tower/castle): extra targets per tooltip
      for (const [id, lvl] of Object.entries(u.abil)) {
        const ab = D.abilities[id];
        if (!ab || ab.base !== 'Aroc' || !lvl) continue;
        const extraN = id === 'A00M' ? lvl : 1; // Archer: level 1 = 2 targets, level 2 = 3 targets
        const area = ab.area[lvl - 1] || u.def.range;
        const others = this.unitsInRange(u.x, u.y, area, x => x !== t && this.enemy(u.owner, x.owner) && this.canTarget(u, x))
          .sort((a, b) => dist(u, a) - dist(u, b)).slice(0, extraN);
        targets.push(...others);
      }
      targets.forEach((tg, i) => {
        const primary = i === 0;
        const hit = () => this.resolveHit(u, tg, primary);
        const w = u.def.weapon;
        if (w === 'missile' || w === 'msplash' || w === 'mbounce' || w === 'artillery') {
          this.projectiles.push({ x: u.x, y: u.y, target: tg, speed: u.def.missile || 900, owner: u.owner, kind: u.def.atk, onHit: hit, src: u.typeId });
        } else {
          if (w === 'instant') this.projectiles.push({ x: u.x, y: u.y, target: tg, speed: 6000, owner: u.owner, kind: u.def.atk, onHit: () => {}, src: u.typeId });
          hit();
        }
      });
    }
    resolveHit(u, t, primary) {
      if (!t.alive()) return;
      let dmg = this.rollDamage(u);
      if (dmg <= 0) { this.emit('hit', u, t, 0, primary); return; }
      // critical strike (ACct): not vs structures
      for (const [id, lvl] of Object.entries(u.abil)) {
        const ab = D.abilities[id]; if (!ab || ab.base !== 'ACct' || !lvl) continue;
        if (t.structure) continue;
        if (this.rng.next() * 100 < ab.dataa[lvl - 1]) { dmg *= ab.datab[lvl - 1]; this.effect('crit', t.x, t.y, 0.8, { text: Math.round(dmg) + '!' }); }
      }
      const atk = u.def.atk;
      let dealt;
      if (u.def.weapon === 'msplash') {
        const full = u.def.splash[0] || 0;
        dealt = 0;
        for (const s of this.unitsInRange(t.x, t.y, full, x => this.enemy(u.owner, x.owner) && !x.invulnerable)) {
          const r = this.damage(u, s, dmg, atk, 'attack'); if (s === t) dealt = r;
        }
        this.effect('splash', t.x, t.y, 0.4, { r: full });
      } else dealt = this.damage(u, t, dmg, atk, 'attack');
      // cleave (ANca): % of damage to other enemies around the target
      for (const [id, lvl] of Object.entries(u.abil)) {
        const ab = D.abilities[id]; if (!ab || ab.base !== 'ANca' || !lvl || !primary) continue;
        const pct = ab.dataa[lvl - 1]; const area = ab.area[lvl - 1] || 200;
        for (const s of this.unitsInRange(t.x, t.y, area, x => x !== t && this.enemy(u.owner, x.owner) && !x.structure))
          this.damage(u, s, dmg * pct, atk, 'attack');
        this.effect('splash', t.x, t.y, 0.3, { r: area });
      }
      // lifesteal (AIva)
      for (const [id, lvl] of Object.entries(u.abil)) {
        const ab = D.abilities[id]; if (!ab || ab.base !== 'AIva' || !lvl || t.structure) continue;
        if (dealt > 0) u.hp = Math.min(u.maxHp(), u.hp + dealt * ab.dataa[lvl - 1]);
      }
      // bash (AHbh): Ogre stun
      for (const [id, lvl] of Object.entries(u.abil)) {
        const ab = D.abilities[id]; if (!ab || ab.base !== 'AHbh' || !lvl) continue;
        if (this.rng.next() * 100 < ab.dataa[lvl - 1]) t.addBuff({ id: 'bash', dur: ab.dur[lvl - 1] || 0.5, stun: true });
      }
      this.emit('hit', u, t, dealt, primary);
    }
    moveToward(u, x, y, stopDist) {
      const d = Math.hypot(x - u.x, y - u.y);
      if (d <= stopDist) { u.path = null; return true; }
      let wx = x, wy = y;
      // re-plan if blocked
      if (u.flying) {
        const step = Math.min(d, u.moveSpeed() * DT); u.x += (x - u.x) / d * step; u.y += (y - u.y) / d * step;
        u.facing = Math.atan2(y - u.y, x - u.x) * 180 / Math.PI; u.moving = true; return false;
      }
      if (!u.path || u.pathGoal !== x + ',' + y || this.tick % 40 === u.id % 40) {
        if (!this.grid.lineClear(u.x, u.y, x, y)) {
          u.path = this.grid.findPath(u.x, u.y, x, y) || [{ x, y }];
        } else u.path = [{ x, y }];
        u.pathGoal = x + ',' + y;
      }
      if (u.path && u.path.length) {
        let p = u.path[0];
        while (u.path.length > 1 && Math.hypot(p.x - u.x, p.y - u.y) < 20) { u.path.shift(); p = u.path[0]; }
        wx = p.x; wy = p.y;
      }
      const dd = Math.hypot(wx - u.x, wy - u.y) || 1;
      const step = Math.min(dd, u.moveSpeed() * DT);
      const nx = u.x + (wx - u.x) / dd * step, ny = u.y + (wy - u.y) / dd * step;
      if (this.grid.walkable(nx, ny)) { u.x = nx; u.y = ny; }
      else if (this.grid.walkable(nx, u.y)) u.x = nx;
      else if (this.grid.walkable(u.x, ny)) u.y = ny;
      u.facing = Math.atan2(wy - u.y, wx - u.x) * 180 / Math.PI;
      u.moving = true;
      return false;
    }
    separate() {
      const mob = this.units.filter(u => u.alive() && !u.structure && u.def.speed > 0 && !u.flags.reincarnating && !u.flying);
      for (let i = 0; i < mob.length; i++) {
        const a = mob[i];
        for (let j = i + 1; j < mob.length; j++) {
          const b = mob[j];
          const dx = b.x - a.x, dy = b.y - a.y; const min = (a.collision + b.collision) * 0.8;
          if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
          const d = Math.hypot(dx, dy);
          if (d >= min) continue;
          const push = (min - d) / 2 * 0.5; const ux = d ? dx / d : 1, uy = d ? dy / d : 0;
          const ax = a.x - ux * push, ay = a.y - uy * push, bx = b.x + ux * push, by = b.y + uy * push;
          if (this.grid.walkable(ax, ay)) { a.x = ax; a.y = ay; }
          if (this.grid.walkable(bx, by)) { b.x = bx; b.y = by; }
        }
      }
    }
  }

  window.Pyro = Object.assign(window.Pyro || {}, { World, Unit, RNG, Grid, TEAM_OF, PLAYER_COLORS, PLAYER_NAMES, DT, dist, rectCenter, inRect });
})();
