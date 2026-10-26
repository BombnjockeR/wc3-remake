/* Pyro TD web port - rendering and input (placeholder graphics).
 * Sprites: put images in window.PYRO_SPRITES = { h000: 'assets/priest.png', ... } (unit type id -> url)
 * and they will be drawn instead of the placeholder shapes.
 */
(function () {
  'use strict';
  const D = window.PYRO_DATA;
  const { World, Rules, AI, DT, TEAM_OF } = window.Pyro;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ------------------------------------------------------------------ placeholder look
  const FAMILY = [
    [/Priest/, '#f5f0c8', 'Pr'], [/Witchdoctor/, '#7bd36b', 'Wd'], [/Frostwizard/, '#9be7ff', 'Fw'], [/Frostmage/, '#c9f2ff', 'Fm'],
    [/Armortrainer/, '#5c86b8', 'At'], [/Armorsmith/, '#86aee0', 'As'], [/Weapontrainer/, '#c4572e', 'Wt'], [/Weaponsmith/, '#f08a5d', 'Ws'],
    [/Chainhealth/, '#e6d3ff', 'CH'], [/Chainweapon/, '#c58bff', 'CW'], [/Chainarmor/, '#9b7bff', 'CA'],
    [/Fast Rulebreaker/, '#ff6ad5', 'FR'], [/Rulebreaker/, '#ff9be6', 'Rb'],
    [/Captain-Evolution/, '#ffd23f', 'Cp'], [/Archer-Evolution/, '#ffd23f', 'Ar'], [/Raider-Evolution/, '#ffd23f', 'Rd'],
    [/Mage-Evolution/, '#ffd23f', 'Mg'], [/Tauren-Evolution/, '#ffd23f', 'Ta'], [/Shaman-Evolution/, '#ffd23f', 'Sh'], [/Evolution/, '#ffe58a', 'Ev'],
    [/Goldtower/, '#e8c547', 'Gt'], [/Goldminer/, '#f2b705', 'Gn'], [/Goldmine/, '#d9a404', 'Gm'],
    [/Yin&Yang/, '#3ee0c8', 'YY'], [/Short Attackspeed/, '#45c4b0', 'SA'], [/Long Attackspeed/, '#2a9d8f', 'LA'], [/Long Slow/, '#5fa8a0', 'LS'],
    [/Short Aura/, '#7ed6c8', 'Au'], [/Long Aura/, '#4fb3a6', 'Au'], [/Aura-Tower/, '#9ae6da', 'Au'],
    [/Casino/, '#b5179e', 'Cs'], [/Chaostower/, '#8b1e3f', 'Ch'],
  ];
  const UNIT_LETTER = { hfoo: 'F', h00I: 'C', h00N: 'A', h01E: 'R', h01G: 'M', h02W: 'T', h03Z: 'S', o000: '+' };
  function look(def) {
    for (const [re, color, ab] of FAMILY) if (re.test(def.name)) {
      const m = /rank (\d)/.exec(def.name); return { color, ab, rank: m ? +m[1] : 1 };
    }
    return { color: '#cccccc', ab: def.name.slice(0, 2), rank: 1 };
  }
  const TEX_COLORS = { Zdrt: [128, 100, 66], Zdtr: [112, 92, 64], Zdrg: [96, 112, 62], Zbks: [128, 124, 116], Zsan: [176, 156, 108],
    Zbkl: [108, 104, 98], Ztil: [150, 146, 136], Zgrs: [64, 112, 48], Zvin: [56, 94, 44], cOc1: [84, 74, 64] };
  const ATK_COLORS = { magic: '#c77dff', chaos: '#ff9f1c', pierce: '#f1f1f1', siege: '#c8a26a', normal: '#ffe066', spells: '#9bf6ff', hero: '#ffd6a5', fire: '#ff5d2a' };
  const sprites = {};
  function sprite(id) {
    const src = (window.PYRO_SPRITES || {})[id]; if (!src) return null;
    if (!sprites[id]) { sprites[id] = new Image(); sprites[id].src = src; }
    return sprites[id].complete && sprites[id].naturalWidth ? sprites[id] : null;
  }

  // ------------------------------------------------------------------ game controller
  const G = {
    world: null, rules: null, ai: null, me: 2, speed: 1, acc: 0, last: 0,
    cam: { x: 0, y: 3000, zoom: 0.16 }, sel: null, placing: null, hover: { x: 0, y: 0 }, keys: {},
    msgSeen: 0, terrain: null,
  };
  window.PyroGame = G;

  function newGame(cfg) {
    const w = new World({ seed: cfg.seed || (Date.now() & 0xffffff) });
    const slots = [[2, 3, 4, 5], [6, 7, 8, 9]];
    const myTeam = cfg.team; G.me = slots[myTeam][0];
    for (const t of [0, 1]) for (let i = 0; i < cfg.perTeam; i++) {
      const p = w.players[slots[t][i]]; p.playing = true;
      p.kind = p.id === G.me ? 'human' : 'ai';
      p.name = p.id === G.me ? (cfg.name || 'You') : 'Computer ' + (p.id + 1);
    }
    const r = new Rules(w, cfg);
    G.world = w; G.rules = r; G.ai = new AI(w, r);
    r.start();
    const base = r.R(myTeam === 0 ? 'gr1_viewarea' : 'gr2_viewarea');
    G.cam.x = myTeam === 0 ? 0 : 0; G.cam.y = myTeam === 0 ? 3500 : -3700; G.cam.zoom = 0.13;
    G.sel = null; G.placing = null; G.msgSeen = 0; G.speed = 1; G.acc = 0;
    $('#log').innerHTML = '';
    w.on('gameOver', (o) => setTimeout(() => showGameOver(o), 1500));
    buildMenu();
    $('#lobby').classList.add('hidden');
  }

  // ------------------------------------------------------------------ terrain pre-render
  function renderTerrain() {
    const t = D.geo.terrain; const S = 8; // world units per pixel
    const W = 8192 / S, H = 12288 / S;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(W, H);
    const cols = t.ground.map(g => TEX_COLORS[g] || [100, 100, 100]);
    const path = D.geo.path; const pf = new Uint8Array(path.w * path.h);
    for (let i = 0; i < pf.length; i++) pf[i] = parseInt(path.data.substr(i * 2, 2), 16);
    for (let py = 0; py < H; py++) {
      const wy = 6144 - (py + 0.5) * S;
      const fy = (wy - t.minY) / 128; const iy = Math.min(t.h - 2, Math.max(0, Math.floor(fy))); const ty = fy - iy;
      for (let px = 0; px < W; px++) {
        const wx = -4096 + (px + 0.5) * S;
        const fx = (wx - t.minX) / 128; const ix = Math.min(t.w - 2, Math.max(0, Math.floor(fx))); const tx = fx - ix;
        const c = [0, 0, 0]; let lay = 0;
        const corners = [[ix, iy, (1 - tx) * (1 - ty)], [ix + 1, iy, tx * (1 - ty)], [ix, iy + 1, (1 - tx) * ty], [ix + 1, iy + 1, tx * ty]];
        for (const [cx, cy, wgt] of corners) {
          const k = cy * t.w + cx; const col = cols[t.tex[k]] || [90, 90, 90];
          c[0] += col[0] * wgt; c[1] += col[1] * wgt; c[2] += col[2] * wgt; lay += t.layer[k] * wgt;
        }
        let shade = 1 + (lay - 2) * 0.13;
        const pcx = Math.floor((wx + 4096) / 32), pcy = Math.floor((wy + 6144) / 32);
        const f = pf[pcy * path.w + pcx];
        if (f & 2) shade *= 0.55; // unwalkable
        const o = (py * W + px) * 4;
        img.data[o] = c[0] * shade; img.data[o + 1] = c[1] * shade; img.data[o + 2] = c[2] * shade; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // trees
    ctx.fillStyle = '#1f4d1a';
    for (const [x, y] of D.geo.trees) { ctx.beginPath(); ctx.arc((x + 4096) / S, (6144 - y) / S, 7, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#6b6258';
    for (const d of D.geo.doodads) { ctx.beginPath(); ctx.arc((d[1] + 4096) / S, (6144 - d[2]) / S, 4, 0, 7); ctx.fill(); }
    G.terrain = { cv, S };
  }

  // ------------------------------------------------------------------ coordinate helpers
  const canvas = () => $('#view');
  function toScreen(x, y) {
    const c = canvas(); return { x: (x - G.cam.x) * G.cam.zoom + c.width / 2, y: (G.cam.y - y) * G.cam.zoom + c.height / 2 };
  }
  function toWorld(sx, sy) {
    const c = canvas(); return { x: (sx - c.width / 2) / G.cam.zoom + G.cam.x, y: G.cam.y - (sy - c.height / 2) / G.cam.zoom };
  }
  function clampCam() {
    const r = D.geo.regions.minimap_area;
    G.cam.x = Math.max(r[0], Math.min(r[2], G.cam.x)); G.cam.y = Math.max(r[1], Math.min(r[3], G.cam.y));
    G.cam.zoom = Math.max(0.05, Math.min(0.6, G.cam.zoom));
  }

  // ------------------------------------------------------------------ main loop
  function frame(ts) {
    const dt = Math.min(0.25, (ts - (G.last || ts)) / 1000); G.last = ts;
    const w = G.world;
    if (w && !w.paused) {
      G.acc += dt * G.speed;
      let n = 0; while (G.acc >= DT && n < 200) { w.step(); G.acc -= DT; n++; }
    }
    // keyboard camera
    const pan = 900 / G.cam.zoom * dt * 0.25;
    if (G.keys.ArrowLeft || G.keys.a) G.cam.x -= pan; if (G.keys.ArrowRight || G.keys.d) G.cam.x += pan;
    if (G.keys.ArrowUp || G.keys.w) G.cam.y += pan; if (G.keys.ArrowDown || G.keys.s) G.cam.y -= pan;
    clampCam();
    if (w) { draw(); drawMinimap(); updateHud(); }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ drawing
  function draw() {
    const c = canvas(); const ctx = c.getContext('2d'); const w = G.world; const z = G.cam.zoom;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) { c.width = c.clientWidth; c.height = c.clientHeight; }
    ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    const tl = toScreen(-4096, 6144);
    ctx.drawImage(G.terrain.cv, tl.x, tl.y, 8192 * z, 12288 * z);
    // maze path hint (waypoint line)
    ctx.strokeStyle = 'rgba(255,240,200,0.18)'; ctx.lineWidth = Math.max(1, 60 * z); ctx.setLineDash([]);
    for (const pre of ['gr1', 'gr2']) {
      const pts = ['start', 'wp1', 'wp2', 'wp3', 'wp4', 'wp5', 'wp6', 'wp7', 'wp8', 'wp9', 'goal'].map(k => G.rules.R(pre + '_' + k)).map(window.Pyro.rectCenter);
      ctx.beginPath(); pts.forEach((p, i) => { const s = toScreen(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke();
    }
    // build grid when placing
    if (G.placing) drawPlacement(ctx);
    // selection range
    const sel = G.sel && w.byId.get(G.sel);
    if (sel && sel.alive()) {
      const s = toScreen(sel.x, sel.y);
      const rng = sel.structure ? (sel.def.points || sel.def.range) : sel.def.range;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(s.x, s.y, rng * z, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // units: structures first
    const list = w.units.filter(u => !u.removed).sort((a, b) => (b.structure - a.structure) || (b.y - a.y));
    for (const u of list) drawUnit(ctx, u, u === sel);
    // projectiles
    for (const p of w.projectiles) {
      if (p.done) continue; const s = toScreen(p.x, p.y);
      ctx.fillStyle = ATK_COLORS[p.kind] || '#fff';
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(2, 10 * z), 0, 7); ctx.fill();
    }
    // effects
    for (const e of w.effects) drawEffect(ctx, e);
  }
  function drawPlacement(ctx) {
    const z = G.cam.zoom; const r = G.rules; const w = G.world;
    const s = r.snap(G.hover.x, G.hover.y);
    const ok = r.canBuildAt(G.me, G.placing, s.x, s.y) && r.available(G.me, G.placing).ok;
    // nearby grid cells
    const g = w.grid;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const cx = g.cx(s.x) + dx, cy = g.cy(s.y) + dy;
      const wx = g.minX + cx * 32, wy = g.minY + cy * 32;
      const p = toScreen(wx, wy + 32);
      ctx.fillStyle = g.buildableCell(cx, cy) ? 'rgba(80,255,120,0.10)' : 'rgba(255,60,60,0.10)';
      ctx.fillRect(p.x, p.y, 32 * z, 32 * z);
    }
    const p = toScreen(s.x - 64, s.y + 64);
    ctx.fillStyle = ok ? 'rgba(80,255,120,0.45)' : 'rgba(255,60,60,0.45)';
    ctx.fillRect(p.x, p.y, 128 * z, 128 * z);
    const def = D.units[G.placing]; const c = toScreen(s.x, s.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(c.x, c.y, (def.points || def.range) * z, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  function teamColor(u) {
    const w = G.world;
    if (u.structure) return w.players[u.owner].color;
    const t = u.flags.colorTeam != null ? u.flags.colorTeam : u.flags.middle != null ? u.flags.middle : TEAM_OF[u.owner];
    return t === 0 ? '#ff4d4d' : '#4d8dff';
  }
  function drawUnit(ctx, u, selected) {
    const z = G.cam.zoom; const s = toScreen(u.x, u.y); const w = G.world;
    const alpha = u.dead ? Math.max(0, 1 - (w.time - (u.deathTime || 0)) / 3) * 0.5 : 1;
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const img = sprite(u.typeId);
    if (u.structure) {
      const size = (u.footprintSize || 4) * 32 * z * (u.collision > 100 ? 1 : 0.92);
      if (img) ctx.drawImage(img, s.x - size / 2, s.y - size / 2, size, size);
      else {
        const lk = look(u.def);
        const isCastle = G.rules.T.castles.includes(u.typeId) || G.rules.T.guardTowers.includes(u.typeId);
        ctx.fillStyle = isCastle ? '#3b3f46' : lk.color;
        roundRect(ctx, s.x - size / 2, s.y - size / 2, size, size, size * 0.15); ctx.fill();
        ctx.lineWidth = Math.max(1.5, size * 0.07); ctx.strokeStyle = w.players[u.owner].color; ctx.stroke();
        if (size > 14) {
          ctx.fillStyle = isCastle ? '#fff' : '#111'; ctx.font = `bold ${Math.round(size * 0.36)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const label = isCastle ? (u.typeId === 'h001' || G.rules.T.castles.includes(u.typeId) ? (G.rules.T.castles.includes(u.typeId) ? 'Castle' : '') : '') : lk.ab;
          ctx.fillText(isCastle ? (G.rules.T.castles.includes(u.typeId) ? '♜' : '♖') : lk.ab, s.x, s.y - (lk.rank > 1 ? size * 0.08 : 0));
          if (!isCastle && lk.rank > 1) { ctx.font = `${Math.round(size * 0.24)}px system-ui`; ctx.fillText('★' + lk.rank, s.x, s.y + size * 0.26); }
        }
        if (u.building) {
          const total = u.building.kind === 'construct' ? u.def.build : D.units[u.building.to].build;
          const f = 1 - Math.max(0, u.building.until - w.time) / total;
          ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size * (1 - f));
        }
        if (u.holdAttack) { ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x - size / 2, s.y - size / 2); ctx.lineTo(s.x + size / 2, s.y + size / 2); ctx.stroke(); }
      }
      if (G.rules.T.castles.includes(u.typeId) || G.rules.T.guardTowers.includes(u.typeId) || selected) hpBar(ctx, u, s, size * 0.5 + 6);
    } else {
      const r = Math.max(3, u.collision * z * 1.1);
      if (img) ctx.drawImage(img, s.x - r * 1.4, s.y - r * 1.4, r * 2.8, r * 2.8);
      else {
        ctx.fillStyle = u.typeId === 'o000' ? '#7bd36b' : teamColor(u);
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.18);
        ctx.strokeStyle = u.invulnerable ? '#ffd700' : u.hasBuff('frost') ? '#9be7ff' : '#111'; ctx.stroke();
        if (r > 6) { ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(r * 1.1)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(UNIT_LETTER[u.typeId] || 'W', s.x, s.y + 1); }
      }
      if (u.stunned()) { ctx.fillStyle = '#ffd700'; ctx.font = `${Math.round(r)}px system-ui`; ctx.fillText('✦', s.x, s.y - r * 1.6); }
      if (u.typeId !== 'o000' && !u.dead) hpBar(ctx, u, s, r + 5);
    }
    if (selected) { ctx.strokeStyle = '#7CFC00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(10, (u.structure ? 70 : u.collision) * z * 1.3), 0, 7); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  function hpBar(ctx, u, s, dy) {
    const z = G.cam.zoom; const wdt = Math.max(18, (u.structure ? 120 : 60) * z); const h = Math.max(3, 8 * z);
    const f = Math.max(0, Math.min(1, u.hp / u.maxHp()));
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(s.x - wdt / 2 - 1, s.y - dy - h - 1, wdt + 2, h + 2);
    ctx.fillStyle = f > 0.6 ? '#3ddc84' : f > 0.3 ? '#ffd23f' : '#ff4d4d';
    ctx.fillRect(s.x - wdt / 2, s.y - dy - h, wdt * f, h);
  }
  function drawEffect(ctx, e) {
    const w = G.world; const z = G.cam.zoom; const t = (w.time - e.at) / e.dur; if (t < 0 || t > 1) return;
    const s = toScreen(e.x, e.y); ctx.globalAlpha = 1 - t;
    if (e.text) {
      ctx.fillStyle = e.color || (e.kind === 'gold' ? '#ffd23f' : e.kind === 'crit' ? '#ff4d4d' : e.kind === 'heal' ? '#3ddc84' : '#fff');
      ctx.font = `bold ${Math.max(10, Math.round(26 * z * 4))}px system-ui`; ctx.textAlign = 'center';
      if (z > 0.09 || e.kind !== 'buff') ctx.fillText(e.text, s.x, s.y - 20 - t * 30);
    } else if (e.kind === 'bolt') {
      const s2 = toScreen(e.x2, e.y2); ctx.strokeStyle = e.color || '#9bf6ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
    } else {
      const R = (e.r || 80) * z * (0.4 + t * 0.6);
      const col = { evolve: '#c77dff', teleport: '#9bf6ff', full: '#ffd700', blizzard: '#bde0fe', meteor: '#ff5d2a', stomp: '#c8a26a',
        lasthope: '#ffffff', splash: '#ffb703', summon: '#adb5bd', reincarnate: '#ffd166', link: '#80ffdb' }[e.kind] || '#fff';
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(4, R), 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawMinimap() {
    const c = $('#minimap'); const ctx = c.getContext('2d'); const w = G.world;
    const r = D.geo.regions.minimap_area; const sx = c.width / (r[2] - r[0]), sy = c.height / (r[3] - r[1]);
    const T = G.terrain; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(T.cv, (r[0] + 4096) / T.S, (6144 - r[3]) / T.S, (r[2] - r[0]) / T.S, (r[3] - r[1]) / T.S, 0, 0, c.width, c.height);
    const P = (x, y) => [(x - r[0]) * sx, (r[3] - y) * sy];
    for (const u of w.units) {
      if (!u.alive()) continue; const [x, y] = P(u.x, u.y);
      ctx.fillStyle = u.structure ? w.players[u.owner].color : teamColor(u);
      const s = u.structure ? (G.rules.T.castles.includes(u.typeId) ? 6 : 3) : 2;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    const cv = canvas(); const a = toWorld(0, 0), b = toWorld(cv.width, cv.height);
    const [x0, y0] = P(a.x, a.y), [x1, y1] = P(b.x, b.y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // ------------------------------------------------------------------ HUD
  function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  let lastPanelKey = '';
  function updateHud() {
    const w = G.world, r = G.rules, me = w.players[G.me];
    $('#gold').textContent = Math.floor(me.gold);
    $('#round').textContent = r.round;
    let timer = '';
    if (r.phase === 'vote' && r.dialog) timer = `${r.dialog.title}: ${fmtTime(r.dialog.end - w.time)}`;
    else if (r.waveEnd) timer = `${r.waveTitle} ${fmtTime(r.waveEnd - w.time)}`;
    else timer = { spawn: 'Spawning', maze: 'Units in the maze', fight: 'Fight!' }[r.phase] || '';
    if (r.phase === 'maze' && !(r.teamReady[0] && r.teamReady[1]) && r.firstTele[0] != null) timer = 'Gathering in the middle';
    $('#timer').textContent = timer;
    $('#mode').textContent = r.goldMode ? 'Gold Mode' : 'Standard';
    const hour = w.timeOfDay(); $('#clock').textContent = (w.isNight() ? '🌙 ' : '☀ ') + String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.floor((hour % 1) * 60)).padStart(2, '0');
    for (const team of [0, 1]) {
      const c = r.castleOf(team);
      $('#castle' + team).textContent = c ? `${Math.round(c.hp)} / ${Math.round(c.maxHp())}` : 'destroyed';
      $('#race' + team).textContent = r.race[team] ? r.RACES[r.race[team]].name : '';
    }
    // speed buttons
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === G.speed && !w.paused));
    $('#pause').classList.toggle('on', w.paused);
    // messages
    const log = $('#log');
    while (G.msgSeen < w.messages.length) {
      const m = w.messages[G.msgSeen++];
      if (m.players && !m.players.includes(G.me)) continue;
      const d = el('div', 'msg', esc(m.text)); d.dataset.until = performance.now() + Math.min(20, m.dur) * 1000 / Math.max(1, G.speed);
      log.appendChild(d); while (log.children.length > 8) log.removeChild(log.firstChild);
    }
    for (const d of [...log.children]) if (performance.now() > +d.dataset.until) d.classList.add('fade');
    // dialogs
    updateDialog();
    // selection & build availability
    const sel = G.sel && w.byId.get(G.sel);
    if (!sel || !sel.alive()) { if (G.sel) { G.sel = null; } }
    const key = panelKey(sel);
    if (key !== lastPanelKey) { lastPanelKey = key; renderPanel(sel); }
    else if (sel) refreshPanelNumbers(sel);
    document.querySelectorAll('#build button').forEach(b => {
      const av = r.available(G.me, b.dataset.unit); b.disabled = !av.ok; b.title = av.ok ? '' : av.why;
      b.classList.toggle('placing', G.placing === b.dataset.unit);
    });
  }

  // ------------------------------------------------------------------ build menu
  function buildMenu() {
    const box = $('#build'); box.innerHTML = '';
    for (const id of D.units.u000.builds) {
      const def = D.units[id];
      if (G.rules.T.goldtowers.includes(id) && id !== G.rules.goldtowerType) continue;
      const lk = look(def);
      const b = el('button', 'bbtn', `<span class="ico" style="background:${lk.color}">${lk.ab}</span><span class="nm">${esc(def.name)}</span><span class="cost">${def.cost}</span>`);
      b.dataset.unit = id;
      b.onclick = () => { G.placing = G.placing === id ? null : id; };
      b.onmouseenter = () => showTip(b, `<b>${esc(def.name)}</b> — ${def.cost} gold<br>${esc(def.tip).replace(/\n/g, '<br>')}`);
      b.onmouseleave = hideTip;
      box.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ selection panel
  function panelKey(u) {
    if (!u) return 'none';
    return [u.id, u.typeId, u.owner, !!u.building, JSON.stringify(u.abil), u.holdAttack, G.rules.rb[G.me] && G.rules.rb[G.me].ai].join('|');
  }
  function statLine(u) {
    const dice = Math.max(0, u.def.dice + u.diceBonus()); const base = u.baseDmg + u.dmgBonus();
    const dmg = dice > 0 ? `${Math.round(base + dice)}–${Math.round(base + dice * u.def.sides)}` : `${Math.round(base)}`;
    return `HP <b>${Math.round(u.hp)} / ${Math.round(u.maxHp())}</b> · Damage <b>${u.hasWeapon() ? dmg : '—'}</b> (${u.def.atk}) · Armor <b>${Math.round(u.armor() * 10) / 10}</b> (${u.def.armorType}) · Cooldown <b>${u.cooldown().toFixed(2)}</b>s · Range <b>${u.def.range}</b>`;
  }
  function refreshPanelNumbers(u) { const s = $('#selstats'); if (s) s.innerHTML = statLine(u); const g = $('#selbuild'); if (g && u.building) g.textContent = `${u.building.kind === 'construct' ? 'Building' : 'Upgrading'}… ${Math.max(0, u.building.until - G.world.time).toFixed(1)}s`; }
  function renderPanel(u) {
    hideTip();
    const p = $('#panel'); p.innerHTML = '';
    if (!u) { p.innerHTML = '<div class="hint">Click a tower or unit to inspect it.<br>Pick a tower on the left, then click a green spot next to your maze to build.<br><br><b>Keys</b>: WASD/arrows pan · wheel zoom · Esc cancel · Space = my base · 1/2/4 speed · P pause</div>'; return; }
    const w = G.world, r = G.rules; const mine = u.owner === G.me;
    const owner = w.players[u.owner];
    p.appendChild(el('div', 'title', `${esc(u.def.name)} <span class="owner" style="color:${owner.color}">${esc(owner.name)}</span>`));
    p.appendChild(el('div', 'stats', '')).id = 'selstats';
    $('#selstats').innerHTML = statLine(u);
    if (u.building) { const g = el('div', 'building', ''); g.id = 'selbuild'; p.appendChild(g); }
    const abil = Object.entries(u.abil).filter(([id, l]) => D.abilities[id] && l && !/^Tower Info|^Info/.test(D.abilities[id].name));
    if (u.def.tip) p.appendChild(el('div', 'tip', esc(u.def.tip).replace(/\n/g, '<br>')));
    if (!u.structure && abil.length) p.appendChild(el('div', 'abils', abil.filter(([id]) => !/unit buff|hero glow|Full Health/.test(D.abilities[id].name)).map(([id, l]) => `<span title="${esc(D.abilities[id].tips[l - 1] || '')}">${esc(D.abilities[id].name)} ${l}</span>`).join(' ')));
    if (u.structure && (u.typeId === 'h04I' || r.T.yinyang[u.typeId])) {
      const sid = r.T.yinyang[u.typeId]; p.appendChild(el('div', 'tip', `Different tower types around: ${(u.abil[sid] || 1) - 1}`));
    }
    if (u.chainValue) p.appendChild(el('div', 'tip', `Chain bonus per hit: ${u.chainValue}`));
    const acts = el('div', 'acts'); p.appendChild(acts);
    if (mine && u.structure && !r.T.castles.includes(u.typeId) && !r.T.guardTowers.includes(u.typeId)) {
      for (const to of u.def.upgradesTo) {
        const d = D.units[to]; const av = r.available(G.me, to);
        const b = el('button', 'act', `▲ ${esc(d.name)} <span class="cost">${d.cost}</span>`);
        b.disabled = !!u.building || !av.ok;
        b.onclick = () => w.command({ pid: G.me, type: 'upgrade', unit: u.id, to });
        b.onmouseenter = () => showTip(b, `<b>${esc(d.name)}</b> — ${d.cost} gold<br>${esc(d.tip).replace(/\n/g, '<br>')}`); b.onmouseleave = hideTip;
        acts.appendChild(b);
      }
      for (const [id, lvl] of Object.entries(u.abil)) {
        const buy = r.BUY[id]; if (!buy) continue;
        const ab = D.abilities[id]; const maxed = lvl >= buy.max; const cost = maxed ? 0 : buy.cost(lvl);
        const b = el('button', 'act buy', `✦ ${esc(ab.name)} <span class="lvl">${lvl - 1}/${buy.max - 1}</span> ${maxed ? '' : `<span class="cost">${cost}</span>`}`);
        b.disabled = maxed;
        b.onclick = () => w.command({ pid: G.me, type: 'buy', unit: u.id, abil: id });
        b.onmouseenter = () => showTip(b, (maxed ? '<b>Maxed</b><br>' : `<b>Next level (${lvl}/${buy.max - 1}) — ${cost} gold</b><br>`) + esc(ab.tips[Math.min(lvl, ab.tips.length) - 1] || ab.name).replace(/\n/g, '<br>')); b.onmouseleave = hideTip;
        acts.appendChild(b);
      }
      if (u.hasWeapon()) { const b = el('button', 'act', u.holdAttack ? '▶ Resume attacking' : '■ Hold attack'); b.onclick = () => w.command({ pid: G.me, type: 'hold', unit: u.id }); acts.appendChild(b); }
      if (r.T.rulebreaker[u.typeId] != null) { const st = r.rb[G.me]; const b = el('button', 'act', st.ai ? 'Rulebreaker AI: ON' : 'Rulebreaker AI: OFF'); b.onclick = () => w.command({ pid: G.me, type: 'rbai', unit: u.id }); acts.appendChild(b); }
      if (u.building) {
        const cancel = el('button', 'act sell', `✖ Cancel ${u.building.kind === 'construct' ? 'construction' : 'upgrade'} (full refund)`);
        cancel.onclick = () => { w.command({ pid: G.me, type: 'cancel', unit: u.id }); }; acts.appendChild(cancel);
      } else {
        const sell = el('button', 'act sell', `✖ Sell (+${Math.floor((u.def.hp) / 2)})`); sell.onclick = () => { w.command({ pid: G.me, type: 'sell', unit: u.id }); G.sel = null; }; acts.appendChild(sell);
      }
    }
    if (r.T.castles.includes(u.typeId) && w.ally(u.owner, G.me) && u.abil.A00N) {
      const b = el('button', 'act sell', '☄ Last Hope (once)'); b.onclick = () => w.command({ pid: G.me, type: 'lastHope', unit: u.id });
      b.onmouseenter = () => showTip(b, esc(D.abilities.A00N.tips[0])); b.onmouseleave = hideTip; acts.appendChild(b);
    }
    if (!u.structure && u.flags.maze != null && w.enemy(u.owner, G.me)) {
      const b = el('button', 'act', '◎ Focus fire with my towers'); b.onclick = () => w.command({ pid: G.me, type: 'focus', target: u.id }); acts.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ dialogs
  let dialogKey = '';
  function updateDialog() {
    const r = G.rules, w = G.world; const box = $('#dialog');
    let key = '';
    if (r.dialog && r.dialog.votes[G.me] == null) key = 'v:' + r.dialog.key;
    else if (r.raceVote && !r.raceVote.votes[G.me] && !r.raceVote.done[w.players[G.me].team]) key = 'race';
    if (key !== dialogKey) {
      dialogKey = key; hideTip(); box.innerHTML = ''; box.classList.toggle('hidden', !key);
      if (key.startsWith('v:')) {
        box.appendChild(el('div', 'dtitle', esc(r.dialog.title) + ' <small>(vote)</small>'));
        r.dialog.options.forEach((o, i) => { const b = el('button', 'dbtn', esc(o)); b.onclick = () => w.command({ pid: G.me, type: 'vote', option: i }); box.appendChild(b); });
        box.appendChild(el('div', 'dtime', ''));
      } else if (key === 'race') {
        box.appendChild(el('div', 'dtitle', 'Choose your Castle & Tower race'));
        for (const [k, v] of Object.entries(r.RACES)) {
          const b = el('button', 'dbtn', `<span style="color:${v.color}">${v.name}</span>`);
          const info = [v.castle, v.tower].map(id => D.units[id]).map(d => `<b>${esc(d.name)}</b><br>${esc((D.abilities[d.abil.find(a => /Info/.test(D.abilities[a] ? D.abilities[a].name : ''))] || { tips: [''] }).tips[0]).replace(/\n/g, '<br>')}`).join('<br><br>');
          b.onmouseenter = () => showTip(b, info); b.onmouseleave = hideTip;
          b.onclick = () => { hideTip(); w.command({ pid: G.me, type: 'raceVote', race: k }); };
          box.appendChild(b);
        }
        box.appendChild(el('div', 'dtime', ''));
      }
    }
    const t = box.querySelector('.dtime');
    if (t) t.textContent = key === 'race' ? fmtTime(r.raceVote.end - w.time) : r.dialog ? fmtTime(r.dialog.end - w.time) : '';
  }
  function showGameOver(o) {
    const w = G.world; const myTeam = w.players[G.me].team; const won = o.winner === myTeam;
    const box = $('#over'); box.classList.remove('hidden');
    box.innerHTML = `<div class="card" style="text-align:center"><div class="dtitle">${won ? 'Victory!' : 'Defeat'}</div><div>${won ? 'The enemy castle fell on wave ' : 'Lost on wave '}${o.round}.</div><button class="dbtn" id="again">Back to lobby</button></div>`;
    $('#again').onclick = () => { box.classList.add('hidden'); $('#lobby').classList.remove('hidden'); };
  }

  // ------------------------------------------------------------------ tooltip
  function showTip(anchor, html) {
    const t = $('#tip'); t.innerHTML = html; t.classList.remove('hidden');
    const r = anchor.getBoundingClientRect(); const tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.right + 8, y = r.top; if (x + tw > innerWidth) x = r.left - tw - 8; if (y + th > innerHeight) y = innerHeight - th - 8;
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { $('#tip').classList.add('hidden'); }

  // ------------------------------------------------------------------ input
  function pick(wx, wy) {
    let best = null, bd = Infinity;
    for (const u of G.world.units) {
      if (!u.alive()) continue;
      const rad = u.structure ? 70 : Math.max(40, u.collision + 12);
      const d = Math.hypot(u.x - wx, u.y - wy); if (d < rad && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  function setupInput() {
    const c = canvas(); let drag = null;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('mousedown', e => {
      const p = toWorld(e.offsetX, e.offsetY);
      if (e.button === 2 || e.button === 1) { drag = { x: e.clientX, y: e.clientY, cx: G.cam.x, cy: G.cam.y, moved: false }; return; }
      if (G.placing) {
        G.world.command({ pid: G.me, type: 'build', unit: G.placing, x: p.x, y: p.y });
        if (!e.shiftKey) G.placing = null;
        return;
      }
      const u = pick(p.x, p.y); G.sel = u ? u.id : null;
      if (!u) drag = { x: e.clientX, y: e.clientY, cx: G.cam.x, cy: G.cam.y, moved: false, left: true };
    });
    addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect(); const p = toWorld(e.clientX - r.left, e.clientY - r.top); G.hover = p;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        G.cam.x = drag.cx - dx / G.cam.zoom; G.cam.y = drag.cy + dy / G.cam.zoom;
      }
    });
    addEventListener('mouseup', e => {
      if (drag && !drag.moved && e.button === 2) { G.placing = null; G.sel = null; }
      drag = null;
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const before = toWorld(e.offsetX, e.offsetY);
      G.cam.zoom *= e.deltaY < 0 ? 1.15 : 1 / 1.15; clampCam();
      const after = toWorld(e.offsetX, e.offsetY); G.cam.x += before.x - after.x; G.cam.y += before.y - after.y;
    }, { passive: false });
    const mm = $('#minimap');
    const mmJump = e => {
      const r = D.geo.regions.minimap_area; const b = mm.getBoundingClientRect();
      G.cam.x = r[0] + (e.clientX - b.left) / b.width * (r[2] - r[0]); G.cam.y = r[3] - (e.clientY - b.top) / b.height * (r[3] - r[1]);
    };
    let mmDown = false;
    mm.addEventListener('mousedown', e => { mmDown = true; mmJump(e); });
    addEventListener('mousemove', e => { if (mmDown) mmJump(e); });
    addEventListener('mouseup', () => { mmDown = false; });
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      G.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
      if (e.key === 'Escape') { G.placing = null; G.sel = null; }
      if (e.key === ' ') { const t = G.world.players[G.me].team; G.cam.x = 0; G.cam.y = t === 0 ? 3500 : -3700; e.preventDefault(); }
      if (e.key === 'p') togglePause();
      if (e.key === '1' || e.key === '2' || e.key === '4') setSpeed(+e.key);
    });
    addEventListener('keyup', e => { G.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
    document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => setSpeed(+b.dataset.speed));
    $('#pause').onclick = togglePause;
    $('#unstuck').onclick = () => G.world && G.world.command({ pid: G.me, type: 'unstuck' });
    $('#info').onclick = () => { $('#quests').classList.toggle('hidden'); };
    $('#quests').onclick = (e) => { if (e.target.id === 'quests') $('#quests').classList.add('hidden'); };
  }
  function setSpeed(s) { G.speed = s; if (G.world) G.world.paused = false; }
  function togglePause() { if (G.world) G.world.paused = !G.world.paused; }

  // ------------------------------------------------------------------ lobby & quests
  function setupLobby() {
    $('#lobbyTitle').textContent = D.texts.title || 'Pyro TD 0.31';
    $('#lobbyDesc').innerHTML = esc(D.texts.description).replace(/\n/g, '<br>');
    $('#start').onclick = () => {
      newGame({ perTeam: +$('#perTeam').value, team: +$('#team').value, name: $('#pname').value || 'You', seed: +$('#seed').value || undefined });
    };
    const q = $('#questBody');
    q.innerHTML = [['Commands', D.texts.commands], ['Patchnotes', D.texts.patchnotes], ['Discord', D.texts.discord], ['Special Thanks', D.texts.thanks], ['Models', D.texts.models]]
      .map(([t, b]) => `<h3>${t}</h3><p>${esc(b || '').replace(/\n/g, '<br>')}</p>`).join('') +
      '<h3>About this web port</h3><p>Rules, numbers and map layout were extracted from Pyro TD 0.31 (w3x). Graphics are placeholders. The computer opponents are new (the original map had no working bots). Chat commands are buttons here: “Unstuck”, camera zoom with the mouse wheel.</p>';
  }

  window.addEventListener('load', () => {
    renderTerrain(); setupInput(); setupLobby();
    requestAnimationFrame(frame);
  });
})();
