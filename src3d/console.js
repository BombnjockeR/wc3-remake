/* Warcraft III style game screen: top resource bar, bottom console (minimap, 3D portrait, info panel,
 * 4x3 command card with hotkeys and tooltips), timer window, messages, dialogs, chat, menus and the lobby.
 * All game actions go through world.command(...) so the same input path works for multiplayer later.
 */
(function () {
  'use strict';
  const D = window.PYRO_DATA; const A = window.PyroAssets; const TR = window.PyroTerrain;
  const { World, Rules, AI, DT, TEAM_OF, inRect, rectCenter } = window.Pyro;
  const { View, resolve, WC3_COLORS } = window.PyroView;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COLOR_NAMES = ['Red', 'Blue', 'Teal', 'Purple', 'Yellow', 'Orange', 'Green', 'Pink', 'Gray', 'Light Blue'];

  // WC3 text: |cAARRGGBB ... |r colour codes, |n and newlines
  function wc3(s) {
    let out = '', open = 0; const str = esc(s);
    const re = /\|c([0-9a-fA-F]{8})|\|r|\|n|\r?\n/g; let last = 0, m;
    while ((m = re.exec(str))) {
      out += str.slice(last, m.index); last = re.lastIndex;
      if (m[1]) { out += `<span style="color:#${m[1].slice(2)}">`; open++; }
      else if (m[0] === '|r') { if (open) { out += '</span>'; open--; } }
      else out += '<br>';
    }
    out += str.slice(last); while (open--) out += '</span>';
    return out;
  }
  const hotkeyTitle = (t) => wc3(t).replace(/\[([A-Z0-9])\]/, '<span class="hk">$1</span>').replace(/^\s*<span class="hk">([A-Z0-9])<\/span>\s*/, '<span class="hk">[$1]</span> ');
  const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------------------------------------------------------------- icons (real BLP if present, otherwise a named placeholder)
  const iconCache = new Map();
  function hashHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 360; }
  function iconName(path) { return String(path || '').split(/[\\/]/).pop().replace(/\.(blp|tga|dds)$/i, '').replace(/^(DIS)?(PAS)?BTN_?/i, '') || '?'; }
  function iconURL(path) {
    const key = String(path || '').toLowerCase(); if (iconCache.has(key)) return iconCache.get(key);
    let url = path && A.hasTexture(path) ? A.imageURL(path) : null; let real = !!url;
    if (!url) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      const hue = hashHue(iconName(path));
      const grd = g.createLinearGradient(0, 0, 64, 64); grd.addColorStop(0, `hsl(${hue},45%,38%)`); grd.addColorStop(1, `hsl(${hue},55%,14%)`);
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2; g.strokeRect(3, 3, 58, 58);
      const name = iconName(path); const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').split(' ');
      const lines = []; let cur = '';
      for (const w of words) { if ((cur + ' ' + w).trim().length > 9 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
      if (cur) lines.push(cur);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#000'; g.shadowBlur = 3;
      const fs = lines.length > 2 ? 11 : 13; g.font = `bold ${fs}px Georgia, serif`;
      lines.slice(0, 4).forEach((l, i) => g.fillText(l.slice(0, 11), 32, 32 + (i - (Math.min(4, lines.length) - 1) / 2) * (fs + 1)));
      url = c.toDataURL();
    }
    const r = { url, real }; iconCache.set(key, r); return r;
  }
  const iconImg = (p) => `<img src="${iconURL(p).url}">`;
  const ICON = {
    move: 'ReplaceableTextures\\CommandButtons\\BTNMove.blp', stop: 'ReplaceableTextures\\CommandButtons\\BTNStop.blp',
    hold: 'ReplaceableTextures\\CommandButtons\\BTNHoldPosition.blp', build: 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp',
    cancel: 'ReplaceableTextures\\CommandButtons\\BTNCancel.blp', resume: 'ReplaceableTextures\\CommandButtons\\BTNAttack.blp',
  };

  // ---------------------------------------------------------------- game state (client side)
  const G = {
    world: null, rules: null, ai: null, view: null, me: 2, speed: 1, acc: 0, last: 0,
    sel: null, hover: null, hoverUnit: null, mode: null, submenu: null, keys: {}, mouse: { x: -1, y: -1, inside: false },
    msgSeen: 0, camDist: 3000, opts: { grid: 'tile', edgePan: true, labels: false, bars: true },
    log: [], chatOpen: false, consoleH: 200, rangeAt: null,
  };
  window.PyroGame = G;
  try { Object.assign(G.opts, JSON.parse(localStorage.getItem('pyro.opts') || '{}')); } catch (e) { /* storage unavailable */ }
  const saveOpts = () => { try { localStorage.setItem('pyro.opts', JSON.stringify(G.opts)); } catch (e) { /* ignore */ } };

  const unit = (id) => (id != null && G.world ? G.world.byId.get(id) : null);
  const selUnit = () => { const u = unit(G.sel); return u && u.alive() ? u : null; };
  const myBuilder = () => G.rules && G.rules.builders ? G.rules.builders[G.me] : null;
  const isCastle = (u) => G.rules.T.castles.includes(u.typeId);
  const isGuard = (u) => G.rules.T.guardTowers.includes(u.typeId);

  // ---------------------------------------------------------------- new game
  function newGame(cfg) {
    const w = new World({ seed: cfg.seed || (Date.now() & 0xffffff) });
    G.me = cfg.me;
    for (const s of cfg.slots) {
      const p = w.players[s.id]; if (s.kind === 'closed' || s.kind === 'open') continue;
      p.playing = true; p.kind = s.kind; p.name = s.kind === 'human' ? (s.name || cfg.name || 'You') : 'Computer (' + COLOR_NAMES[s.id] + ')';
    }
    const r = new Rules(w, cfg);
    G.world = w; G.rules = r; G.ai = new AI(w, r);
    const N = window.PyroNet;
    if (N && N.role) { N.world = w; G.tick0 = 0; if (N.role === 'client') w.command = (c) => N.sendCmd(c); }
    r.start();
    G.view.attach(w, r, G.me);
    const team = w.players[G.me].team;
    jumpHome();
    G.sel = myBuilder() ? myBuilder().id : null; G.mode = null; G.submenu = null; G.msgSeen = 0; G.speed = 1; G.acc = 0; G.log = [];
    $('#msgs').innerHTML = ''; $('#errmsg').textContent = '';
    w.on('gameOver', (o) => setTimeout(() => showGameOver(o), 1500));
    w.on('constructFinish', (u) => { if (u.owner === G.me && window.PyroSound) PyroSound.play('JobDoneSoundHuman'); });
    w.on('upgradeFinish', (u) => { if (u.owner === G.me && window.PyroSound) PyroSound.play('UpgradeCompleteHuman'); });
    w.on('roundEnd', () => { if (window.PyroSound) PyroSound.play('Hint'); });
    if (window.PyroSound) PyroSound.playMusic('game');
    w.on('builderChanged', (b) => { if (b.owner === G.me) G.sel = b.id; });
    cardKey = ''; infoKey = '';
    void team;
  }
  function jumpHome() {
    const team = G.world.players[G.me].team; const b = myBuilder();
    if (b) { G.view.cam.x = b.x; G.view.cam.y = b.y - 300; } else { G.view.cam.x = 0; G.view.cam.y = team === 0 ? 3300 : -3900; }
  }

  // ---------------------------------------------------------------- layout
  function layout() { // Warcraft's console is 4:3; on wide screens it is centred and the sides are filled with stone
    const W = innerWidth, H = innerHeight;
    const cw = Math.round(Math.min(W, H * 4 / 3)); const sc = cw / 1600;
    G.consoleH = Math.round(326 * sc); G.uiScale = sc;
    const st = document.documentElement.style;
    st.setProperty('--s', sc.toFixed(4)); st.setProperty('--cw', cw + 'px'); st.setProperty('--cx', Math.round((W - cw) / 2) + 'px'); st.setProperty('--ch', G.consoleH + 'px');
    const worldH = H - G.consoleH + Math.round(54 * sc); // the world shows through above the stone wall
    G.view.resize(W, H, worldH);
    const ov = $('#ov'); ov.style.height = worldH + 'px';
  }
  // ---------------------------------------------------------------- skin: Warcraft III interface textures
  function img(path) { return A.image(path); }
  function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function borderImage(path, piece) { // WC3 8-piece border strip (L, R, T, B, UL, UR, BL, BR) -> 3x3 nine-slice for CSS border-image
    const im = img(path); if (!im || im.data) return null;
    const p = piece || im.height; const c = cnv(p * 3, p * 3); const g = c.getContext('2d');
    const part = (i, x, y, rot) => { g.save(); g.translate(x * p + p / 2, y * p + p / 2); if (rot) g.rotate(rot); g.drawImage(im, i * p, 0, p, p, -p / 2, -p / 2, p, p); g.restore(); };
    part(4, 0, 0); part(5, 2, 0); part(6, 0, 2); part(7, 2, 2);
    part(0, 0, 1); part(1, 2, 1); part(2, 1, 0, Math.PI / 2); part(3, 1, 2, Math.PI / 2);
    return `url(${c.toDataURL()})`;
  }
  function buildSkin() {
    const st = document.documentElement.style;
    const tiles = [1, 2, 3, 4].map(i => img(`UI\\Console\\Human\\HumanUITile0${i}.blp`));
    if (tiles.every(t => t && !t.data)) {
      const full = cnv(1600, 512); const g = full.getContext('2d'); let x = 0; for (const t of tiles) { g.drawImage(t, x, 0); x += t.width; }
      // bottom console: holes below the stone line become black, except the portrait window (3D portrait shows there)
      const cons = cnv(1600, 326); const cg = cons.getContext('2d'); cg.drawImage(full, 0, 186, 1600, 326, 0, 0, 1600, 326);
      const d = cg.getImageData(0, 0, 1600, 326); const a = d.data;
      for (let y = 54; y < 326; y++) for (let x2 = 0; x2 < 1600; x2++) {
        const o = (y * 1600 + x2) * 4; if (a[o + 3] > 200) continue;
        if (x2 >= 431 && x2 < 581 && y + 186 >= 289 && y + 186 < 450) continue;
        const k = a[o + 3] / 255; a[o] *= k; a[o + 1] *= k; a[o + 2] *= k; a[o + 3] = 255;
      }
      cg.putImageData(d, 0, 0); st.setProperty('--img-console', `url(${cons.toDataURL()})`);
      const top = cnv(1600, 95); top.getContext('2d').drawImage(full, 0, 0, 1600, 95, 0, 0, 1600, 95); st.setProperty('--img-top', `url(${top.toDataURL()})`);
      const tf = cnv(170, 42); tf.getContext('2d').drawImage(full, 172, 0, 170, 42, 0, 0, 170, 42); st.setProperty('--img-topfill', `url(${tf.toDataURL()})`);
      const sf = cnv(36, 326); sf.getContext('2d').drawImage(full, 1194, 186, 36, 326, 0, 0, 36, 326); st.setProperty('--img-fill', `url(${sf.toDataURL()})`);
    }
    const inv = A.imageURL('UI\\Console\\Human\\HumanUITile-InventoryCover.blp'); if (inv) st.setProperty('--img-invcover', `url(${inv})`);
    const tb = borderImage('UI\\Widgets\\ToolTips\\Human\\human-tooltip-border.blp'); if (tb) st.setProperty('--tipborder', tb);
    const db = borderImage('UI\\Widgets\\EscMenu\\Human\\human-options-menu-border.blp'); if (db) st.setProperty('--dlgborder', db);
    const bb = borderImage('UI\\Widgets\\EscMenu\\Human\\human-options-button-border-up.blp'); if (bb) st.setProperty('--btnborder', bb);
    const bd = borderImage('UI\\Widgets\\EscMenu\\Human\\human-options-button-border-down.blp'); if (bd) st.setProperty('--btnborderdown', bd);
    const bg = A.imageURL('UI\\Widgets\\EscMenu\\Human\\human-options-menu-background.blp'); if (bg) st.setProperty('--dlgback', `url(${bg})`);
    for (const [id, f] of [['ico-gold', 'ResourceGold'], ['ico-lumber', 'ResourceLumber'], ['ico-supply', 'ResourceSupply']]) { const u = A.imageURL(`UI\\Feedback\\Resources\\${f}.blp`); if (u) $('#' + id).src = u; }
    // cursor: HumanCursor.blp is a sheet of 32x32 frames (row 0 = pointer, row 1 = targeting)
    const cur = img('UI\\Cursor\\HumanCursor.blp');
    if (cur && !cur.data) {
      const frame = (col, row) => { const c = cnv(32, 32); c.getContext('2d').drawImage(cur, col * 32, row * 32, 32, 32, 0, 0, 32, 32); return c.toDataURL(); };
      st.setProperty('--cur-normal', `url(${frame(0, 0)}) 3 2, default`); st.setProperty('--cur-target', `url(${frame(0, 1)}) 16 16, crosshair`);
    }
    const ls = loadingComposite(); if (ls) st.setProperty('--img-lobby', `url(${ls.toDataURL('image/jpeg', 0.85)})`);
  }
  async function loadFont() { // Warcraft's Friz Quadrata (Fonts\FRIZQT__.TTF)
    const url = A.blobURL('Fonts\\FRIZQT__.TTF', 'font/ttf'); if (!url || !window.FontFace) return;
    try { const f = new FontFace('Friz', `url(${url})`); await f.load(); document.fonts.add(f); if (G.view) G.view.font = 'Friz, Georgia, serif'; } catch (e) { console.warn('font', e); }
  }

  // ---------------------------------------------------------------- command card
  let cardKey = '', cardBtns = [];
  function placeButtons(list) {
    const grid = Array(12).fill(null);
    for (const b of list.filter(b => b.fixed)) { const i = b.y * 4 + b.x; grid[i] = b; }
    for (const b of list.filter(b => !b.fixed)) {
      let i = Math.max(0, Math.min(11, (b.y | 0) * 4 + (b.x | 0)));
      let n = 0; while (grid[i] && n < 12) { i = (i + 1) % 12; n++; }
      if (!grid[i]) grid[i] = b;
    }
    return grid;
  }
  function abilityButton(u, id, lvl) {
    const ab = D.abilities[id]; if (!ab) return null;
    const r = G.rules; const w = G.world; const mine = u.owner === G.me;
    const L = Math.max(1, Math.min(lvl || 1, ab.levels || 1));
    const b = { id, x: ab.btn[0], y: ab.btn[1], icon: ab.icon, hotkey: ab.hotkey || '', title: ab.tipTitles[L - 1] || ab.name, tip: ab.tips[L - 1] || '' };
    const buy = r.BUY[id];
    if (buy && mine) {
      const maxed = lvl >= buy.max; const cost = maxed ? 0 : buy.cost(lvl);
      b.title = (ab.tipTitles[Math.min(lvl, ab.tipTitles.length) - 1] || ab.name) + (maxed ? '' : ` - [Level ${lvl}]`);
      b.tip = ab.tips[Math.min(lvl, ab.tips.length) - 1] || '';
      b.level = `${lvl - 1}/${buy.max - 1}`; b.cost = maxed ? null : cost; b.disabled = maxed || !!u.building;
      b.why = maxed ? 'Maximum level reached.' : '';
      b.run = () => w.command({ pid: G.me, type: 'buy', unit: u.id, abil: id });
      return b;
    }
    if (id === 'A01X') { // Hold Attack toggle
      if (!mine || !u.hasWeapon()) return null;
      if (u.holdAttack) { b.title = '[S] Resume attacking'; b.tip = 'The tower starts attacking again.'; b.icon = ICON.resume; }
      b.active = u.holdAttack; b.disabled = !!u.building; b.run = () => w.command({ pid: G.me, type: 'hold', unit: u.id }); return b;
    }
    if (id === 'A05P') {
      if (!mine) return null; const on = r.rb[G.me] && r.rb[G.me].ai;
      b.title = on ? '[C] DEACTIVATE Rulebreaker AI' : '[C] ACTIVATE Rulebreaker AI'; b.active = on;
      b.run = () => w.command({ pid: G.me, type: 'rbai', unit: u.id }); return b;
    }
    if (id === 'A00G') {
      if (!mine || u.building) return null;
      b.title = 'Destroy tower'; b.tip = `Destroys this tower and refunds half of the invested gold (|cffffcc00${Math.floor(u.def.hp / 2)}|r gold).`;
      b.run = () => { w.command({ pid: G.me, type: 'sell', unit: u.id }); G.sel = null; }; return b;
    }
    if (id === 'A00N') {
      if (!w.ally(u.owner, G.me)) return null;
      b.run = () => w.command({ pid: G.me, type: 'lastHope', unit: u.id }); b.hotkey = 'T'; return b;
    }
    b.passive = true; return b; // info / passive abilities (shown like WC3 passive buttons)
  }
  function cardFor(u) {
    const r = G.rules, w = G.world; const list = [];
    const cancel = (fn) => ({ x: 3, y: 2, fixed: true, icon: ICON.cancel, hotkey: 'Escape', title: 'Cancel', tip: '', run: fn });
    if (!u) return [];
    if (G.mode) return [cancel(() => setMode(null))];
    const mine = u.owner === G.me;
    if (u.buildQueue && mine) { // the builder
      if (G.submenu === 'build') {
        for (const id of u.def.builds) {
          const d = D.units[id]; if (r.T.goldtowers.includes(id) && id !== r.goldtowerType) continue;
          const av = r.available(G.me, id);
          list.push({ id, x: d.btn[0], y: d.btn[1], icon: d.art, hotkey: d.hotkey, title: d.tipTitle || d.name, tip: d.tip, cost: d.cost,
            disabled: !av.ok && av.why !== 'Not enough gold', why: av.ok ? '' : av.why, run: () => setMode({ kind: 'build', typeId: id }) });
        }
        list.push(cancel(() => { G.submenu = null; }));
        return list;
      }
      list.push({ x: 0, y: 0, fixed: true, icon: ICON.move, hotkey: 'M', title: '[M] Move', tip: 'Orders the builder to move to the target location.', run: () => setMode({ kind: 'point', what: 'move' }) });
      list.push({ x: 1, y: 0, fixed: true, icon: ICON.stop, hotkey: 'S', title: '[S] Stop', tip: 'Orders the builder to stop and clears its build queue.', run: () => w.command({ pid: G.me, type: 'stop', unit: u.id }) });
      list.push({ x: 2, y: 0, fixed: true, icon: ICON.hold, hotkey: 'H', title: '[H] Hold Position', tip: 'Orders the builder to hold its position.', run: () => w.command({ pid: G.me, type: 'stop', unit: u.id }) });
      list.push({ x: 0, y: 2, fixed: true, icon: ICON.build, hotkey: 'B', title: '[B] Build Structure', tip: 'Shows the list of towers this builder can build.', run: () => { G.submenu = 'build'; } });
      for (const id of u.def.abil) {
        if (id === 'Avul') continue; const ab = D.abilities[id]; if (!ab) continue;
        const b = { id, x: ab.btn[0], y: ab.btn[1], icon: ab.icon, hotkey: ab.hotkey, title: ab.tipTitles[0] || ab.name, tip: ab.tips[0] };
        if (id === 'A05I') b.run = () => setMode({ kind: 'unit', what: 'focus' });
        else if (id === 'A03E') b.run = () => setMode({ kind: 'any', what: 'range' });
        else if (/^Change to/.test(ab.name)) {
          const to = { A011: 'u002', A01G: 'u000', A01H: 'u003' }[id]; b.title = ab.name; b.tip = ab.tips[0];
          b.run = () => w.command({ pid: G.me, type: 'skin', unit: u.id, to });
        } else b.passive = true;
        list.push(b);
      }
      return list;
    }
    if (u.structure && mine && !isCastle(u) && !isGuard(u)) {
      if (u.building) return [cancel(() => w.command({ pid: G.me, type: 'cancel', unit: u.id }))].map(b => Object.assign(b, {
        title: u.building.kind === 'construct' ? 'Cancel construction' : 'Cancel upgrade', tip: 'Refunds the full cost.' }));
      for (const to of u.def.upgradesTo) {
        const d = D.units[to]; const av = r.available(G.me, to);
        list.push({ id: to, x: d.btn[0], y: d.btn[1], icon: d.art, hotkey: d.hotkey, title: d.tipTitle ? 'Upgrade to ' + d.tipTitle.replace(/^\[.\]\s*/, '') + (d.hotkey ? ` [${d.hotkey}]` : '') : 'Upgrade to ' + d.name,
          tip: d.tip, cost: d.cost, disabled: !av.ok && av.why !== 'Not enough gold', why: av.ok ? '' : av.why, run: () => w.command({ pid: G.me, type: 'upgrade', unit: u.id, to }) });
      }
      for (const [id, lvl] of Object.entries(u.abil)) {
        if (id === 'Avul' || id === 'A03Q') continue;
        const b = abilityButton(u, id, lvl); if (b) list.push(b);
      }
      return list;
    }
    if (isCastle(u) && w.ally(u.owner, G.me)) {
      for (const [id, lvl] of Object.entries(u.abil)) { const b = abilityButton(u, id, lvl); if (b) list.push(b); }
      return list;
    }
    return list;
  }
  const CARD_X = [1233, 1321, 1408, 1495], CARD_Y = [59, 147, 234]; // command card cells in console pixels
  function renderCard(force) {
    const u = selUnit();
    const btns = cardFor(u);
    const key = (u ? u.id + u.typeId : '') + '|' + G.submenu + '|' + (G.mode ? G.mode.kind + G.mode.what + G.mode.typeId : '') + '|' +
      btns.map(b => [b.id, b.title, b.cost, b.disabled, b.active, b.level, b.icon].join(',')).join(';') + '|' + (G.world ? Math.floor(G.world.players[G.me].gold) : 0);
    if (key === cardKey && !force) return; cardKey = key;
    const grid = placeButtons(btns); cardBtns = grid;
    const card = $('#card'); card.innerHTML = '';
    const gold = G.world ? G.world.players[G.me].gold : 0;
    grid.forEach((b, i) => {
      const slot = el('div', 'slot');
      slot.style.cssText = `position:absolute;left:calc(${CARD_X[i % 4]}px * var(--s));top:calc(${CARD_Y[Math.floor(i / 4)]}px * var(--s));width:calc(80px * var(--s));height:calc(79px * var(--s));`;
      if (b) {
        const ic = iconURL(b.icon);
        const poor = b.cost != null && gold < b.cost;
        const btn = el('button', 'cbtn' + (b.passive ? ' passive' : '') + (b.disabled ? ' off' : '') + (poor ? ' poor' : '') + (b.active ? ' active' : '') + (ic.real ? '' : ' ph'));
        btn.style.backgroundImage = `url(${ic.url})`;
        if (b.hotkey && b.hotkey.length === 1) btn.appendChild(el('span', 'hkb', b.hotkey));
        if (b.level) btn.appendChild(el('span', 'lvl', b.level));
        btn.onmouseenter = () => showTip(b, btn); btn.onmouseleave = hideTip;
        btn.onmousedown = (e) => e.stopPropagation();
        btn.onclick = () => pressButton(b);
        btn.style.left = '0'; btn.style.top = '0'; btn.style.width = '100%'; btn.style.height = '100%';
        slot.appendChild(btn);
      }
      card.appendChild(slot);
    });
  }
  function pressButton(b) {
    if (!b || b.passive) return;
    if (b.disabled) { errorMsg(b.why || 'Unavailable.'); return; }
    if (b.cost != null && G.world.players[G.me].gold < b.cost && !(G.submenu === 'build')) { errorMsg('Not enough gold.'); return; }
    const card = $('#card'); const i = cardBtns.indexOf(b); if (i >= 0 && card.children[i]) { const e = card.children[i].firstChild; e.classList.add('down'); setTimeout(() => e.classList.remove('down'), 120); }
    if (window.PyroSound) PyroSound.play('InterfaceClick');
    b.run && b.run(); cardKey = ''; hideTip();
  }
  function showTip(b, owner) {
    const t = $('#tip'); G.tipOwner = owner || null; G.tipSlot = owner ? cardBtns.indexOf(b) : -1;
    let h = `<div class="tt">${hotkeyTitle(b.title || '')}</div>`;
    if (b.cost != null) h += `<div class="tc"><img src="${A.imageURL('UI\\Widgets\\ToolTips\\Human\\ToolTipGoldIcon.blp') || ''}">${b.cost}</div>`;
    if (b.level) h += `<div class="tl">Purchased: ${b.level}</div>`;
    if (b.tip) h += `<div class="tb">${wc3(b.tip)}</div>`;
    if (b.why) h += `<div class="tw">${esc(b.why)}</div>`;
    if (b.icon && !iconURL(b.icon).real) h += `<div class="tm">Icon (missing): ${esc(b.icon)}</div>`;
    t.innerHTML = h; t.classList.remove('hidden');
  }
  function hideTip() { $('#tip').classList.add('hidden'); G.tipOwner = null; G.tipSlot = -1; }
  function checkTip() { // the card re-renders often (gold changes): keep the tooltip on the slot under the mouse, drop it otherwise
    const o = G.tipOwner; if (!o || o.isConnected) return;
    const slot = G.tipSlot; const card = $('#card');
    const nb = slot >= 0 && cardBtns[slot]; const el2 = nb && card.children[slot] && card.children[slot].firstChild;
    if (el2 && el2.matches(':hover')) showTip(nb, el2); else hideTip();
  }

  // ---------------------------------------------------------------- targeting / placement
  function setMode(m) {
    G.mode = m; if (m) G.submenu = null; cardKey = '';
    document.body.classList.toggle('targeting', !!m && m.kind !== 'build');
    if (!m || m.kind !== 'build') { G.view.setPlacement(null); G.view.setHighlightRects(null); }
  }
  function snapPos(x, y, typeId) {
    if (G.opts.grid === 'tile') return { x: Math.floor(x / 128) * 128 + 64, y: Math.floor(y / 128) * 128 + 64 };
    return G.rules.snap(x, y);
  }
  function placementInfo(typeId, wx, wy) {
    const r = G.rules, w = G.world, g = w.grid; const s = snapPos(wx, wy, typeId);
    const area = r.teamArea(G.me); const cells = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = s.x - 64 + i * 32, y = s.y - 64 + j * 32;
      let ok = g.buildableCell(g.cx(x + 1), g.cy(y + 1)) && inRect(area, x, y) && inRect(area, x + 32, y + 32);
      if (ok) ok = !w.units.some(u => u.alive() && !u.structure && !u.flying && u.x + u.collision > x && u.x - u.collision < x + 32 && u.y + u.collision > y && u.y - u.collision < y + 32);
      cells.push({ x, y, ok });
    }
    const d = D.units[typeId];
    return { typeId, x: s.x, y: s.y, cells, ok: r.canBuildAt(G.me, typeId, s.x, s.y), range: d.points || d.range };
  }
  function updatePlacement() {
    if (!G.mode || G.mode.kind !== 'build' || !G.hover) return;
    const p = placementInfo(G.mode.typeId, G.hover.x, G.hover.y); G.placeInfo = p;
    G.view.setPlacement(p);
    G.view.setHighlightRects(G.mode.typeId === 'h004' ? [G.rules.R('rulebreaker_region'), G.rules.R('rulebreaker_region_team2')] : null);
  }
  function clickWorld(e, sx, sy) {
    const w = G.world; const p = G.view.groundAt(sx, sy); if (!p) return;
    const m = G.mode; const b = myBuilder();
    if (m && m.kind === 'build') {
      const info = placementInfo(m.typeId, p.x, p.y);
      if (!info.ok) { errorMsg(m.typeId === 'h004' && info.cells.every(c => c.ok) ? 'Rulebreaker can only be positioned at the start of the maze.' : "Can't build there."); return; }
      const av = G.rules.available(G.me, m.typeId); if (!av.ok) { errorMsg(av.why === 'Not enough gold' ? 'Not enough gold.' : av.why); return; }
      if (b && b.alive()) w.command({ pid: G.me, type: 'build', builder: b.id, unit: m.typeId, x: info.x, y: info.y, queue: e.shiftKey });
      else w.command({ pid: G.me, type: 'build', unit: m.typeId, x: info.x, y: info.y });
      if (!e.shiftKey) setMode(null);
      return;
    }
    if (m && m.kind === 'point' && m.what === 'move') {
      if (b) { w.command({ pid: G.me, type: 'move', unit: b.id, x: p.x, y: p.y }); G.view.ping(p.x, p.y); }
      setMode(null); return;
    }
    if (m && m.what === 'focus') {
      const t = G.view.pick(sx, sy);
      if (!t || t.structure || t.flags.maze == null) { errorMsg('Must target a unit in the maze.'); return; }
      w.command({ pid: G.me, type: 'focus', target: t.id }); G.view.ping(t.x, t.y, 0xff3030); setMode(null); return;
    }
    if (m && m.what === 'range') {
      const t = G.view.pick(sx, sy);
      if (t && t.structure) G.view.showRange(t.x, t.y, t.def.points || t.def.range, 5);
      else if (t && t.flags.maze != null) G.view.showRange(t.x, t.y, t.def.range, 5);
      else { G.rangeAt = p; showRangeDialog(); }
      setMode(null); return;
    }
    // selection
    const u = G.view.pick(sx, sy); G.sel = u ? u.id : null; G.submenu = null; cardKey = '';
    if (u) ack(u, 'What');
  }
  function ack(u, kind) { // unit acknowledgement sounds (UnitAckSounds.slk)
    const S = window.PYRO_SOUNDS; if (!S || !window.PyroSound) return;
    const a = S.acks[u.typeId]; if (a && a[kind]) PyroSound.play(a[kind]);
  }
  function rightClickWorld(sx, sy) {
    if (G.mode) { setMode(null); return; }
    if (G.submenu) { G.submenu = null; return; }
    const u = selUnit(); const b = myBuilder();
    if (u && b && u.id === b.id) { const p = G.view.groundAt(sx, sy); if (p) { G.world.command({ pid: G.me, type: 'move', unit: b.id, x: p.x, y: p.y }); G.view.ping(p.x, p.y); } }
  }

  // ---------------------------------------------------------------- info panel + portrait text
  let infoKey = '';
  function statBlock(u) {
    const dice = Math.max(0, u.def.dice + u.diceBonus()); const base = u.baseDmg + u.dmgBonus();
    const lo = Math.round(base + dice), hi = Math.round(base + dice * u.def.sides);
    const bonus = Math.round(u.baseDmg - u.def.dmg + u.dmgBonus());
    const arm = Math.round(u.armor() * 10) / 10; const armBonus = Math.round((u.armor() - u.def.armor) * 10) / 10;
    const ATK = { normal: 'melee', pierce: 'piercing', siege: 'siege', magic: 'magic', chaos: 'chaos', hero: 'hero', spells: 'magic' };
    const ARM = { small: 'small', medium: 'medium', large: 'large', fortified: 'fortified', hero: 'hero', divine: 'divine', none: 'unarmored', normal: 'medium' };
    const ico = (kind, t) => { const url = A.imageURL(`UI\\Widgets\\Console\\Human\\infocard-${kind}-${t}.blp`); return url ? `<img src="${url}">` : `<span class="sico ${kind === 'attack' ? 'atk' : 'arm'}"></span>`; };
    let h = '<div class="stats">';
    if (u.hasWeapon()) h += `<div class="st">${ico('attack', ATK[u.def.atk] || 'melee')}<div><div class="k">Damage:</div><div class="v">${lo === hi ? lo : lo + ' - ' + hi}${bonus > 0 ? ` <span class="bonus">+${bonus}</span>` : ''}</div></div></div>`;
    h += `<div class="st">${ico('armor', ARM[u.def.armorType] || 'unarmored')}<div><div class="k">Armor:</div><div class="v">${arm}${armBonus > 0 ? ` <span class="bonus">+${armBonus}</span>` : ''}</div></div></div>`;
    if (u.hasWeapon()) h += `<div class="st">${iconImg('ReplaceableTextures\\CommandButtons\\BTNAttack.blp')}<div><div class="k">Range / Cooldown:</div><div class="v">${u.def.range} / ${u.cooldown().toFixed(2)}s</div></div></div>`;
    if (!u.structure) h += `<div class="st">${iconImg('ReplaceableTextures\\CommandButtons\\BTNMove.blp')}<div><div class="k">Speed:</div><div class="v">${Math.round(u.moveSpeed())}</div></div></div>`;
    h += '</div>';
    return h;
  }
  function renderInfo() {
    const u = selUnit(); const box = $('#info'); const w = G.world, r = G.rules;
    // portrait captions
    if (!u) { $('#hp').textContent = ''; $('#mp').textContent = ''; }
    else {
      const f = u.hp / u.maxHp(); $('#hp').textContent = `${Math.ceil(u.hp)} / ${Math.round(u.maxHp())}`;
      $('#hp').style.color = f > 0.66 ? '#00ff00' : f > 0.33 ? '#ffff00' : '#ff2020'; $('#mp').textContent = '';
    }
    const key = u ? [u.id, u.typeId, !!u.building, JSON.stringify(u.abil), u.holdAttack, u.invulnerable, u.buffs.map(b => b.id).join(), Math.round(u.baseDmg), Math.round(u.baseArmor), u.chainValue, Math.round(u.dmgBonus()), Math.round(u.armor() * 10), Math.round(u.moveSpeed()), u.techLevel ? 0 : 0].join('|') : 'none';
    if (u && u.building) { const bar = $('#bprog'); if (bar) { const total = u.building.kind === 'construct' ? u.def.build : D.units[u.building.to].build; const pf = 1 - Math.max(0, u.building.until - w.time) / total; bar.style.width = (pf * 100).toFixed(1) + '%'; $('#bpct').textContent = Math.floor(pf * 100) + '%'; } }
    if (key === infoKey) return; infoKey = key;
    if (!u) { box.innerHTML = '<div class="empty"></div>'; return; }
    const owner = w.players[u.owner]; const rs = resolve(u.def);
    let h = `<div class="uname">${esc(u.def.name)}</div>`;
    h += `<div class="usub"><span style="color:${WC3_COLORS[u.owner]}">■</span> ${esc(owner.name || ('Player ' + (u.owner + 1)))}${u.def.suffix ? ' — ' + esc(u.def.suffix) : ''}</div>`;
    if (u.building) {
      const to = u.building.kind === 'upgrade' ? D.units[u.building.to] : u.def;
      h += `<div class="bwrap"><img class="bico" src="${iconURL(to.art).url}"><div class="bcol"><div class="btxt">${u.building.kind === 'construct' ? 'Constructing' : 'Upgrading to ' + esc(to.name)}</div><div class="bbar"><div id="bprog"></div><span id="bpct"></span></div></div></div>`;
    } else h += statBlock(u);
    const notes = [];
    if (u.invulnerable) notes.push('<span class="buff gold">Invulnerable</span>');
    for (const b of u.buffs) notes.push(`<span class="buff">${esc({ frost: 'Frost (slowed)', stun: 'Stunned' }[b.id] || b.id)}</span>`);
    if (u.holdAttack) notes.push('<span class="buff red">Holding fire</span>');
    if (u.chainValue) notes.push(`<span class="buff">Chain bonus ${u.chainValue}</span>`);
    if (u.structure && (u.typeId === 'h04I' || r.T.yinyang[u.typeId])) { const sid = r.T.yinyang[u.typeId]; notes.push(`<span class="buff">Different towers nearby: ${(u.abil[sid] || 1) - 1}</span>`); }
    if (notes.length) h += `<div class="notes">${notes.join('')}</div>`;
    // abilities on units you don't control (fighters, enemy towers): shown as small passive icons
    if (u.owner !== G.me) {
      const ab = Object.entries(u.abil).filter(([id, l]) => l && D.abilities[id] && id !== 'Avul' && id !== 'A03Q' && !/unit buff|hero glow/i.test(D.abilities[id].name));
      if (ab.length) h += `<div class="abrow">${ab.map(([id, l]) => `<img class="abi" data-ab="${id}" data-l="${l}" src="${iconURL(D.abilities[id].icon).url}">`).join('')}</div>`;
    }
    h += `<div class="model">${rs.standin ? 'Stand-in for' : 'Model'}: ${esc(u.def.model || '(none)')}</div>`;
    box.innerHTML = h;
    box.querySelectorAll('.abi').forEach(img => {
      const ab = D.abilities[img.dataset.ab]; const l = +img.dataset.l;
      img.onmouseenter = () => showTip({ title: (ab.tipTitles[Math.min(l, ab.tipTitles.length) - 1] || ab.name) + (ab.levels > 1 ? ` (Level ${l})` : ''), tip: ab.tips[Math.min(l, ab.tips.length) - 1], icon: ab.icon }, img);
      img.onmouseleave = hideTip;
    });
  }

  // ---------------------------------------------------------------- minimap
  const MM = { img: null, size: 0 };
  function mmMap() {
    const pb = D.geo.bounds.playable; const S = MM.size; const pw = pb[2] - pb[0], ph = pb[3] - pb[1];
    const s = S / Math.max(pw, ph); const ox = (S - pw * s) / 2, oy = (S - ph * s) / 2;
    return { s, ox, oy, pb, to: (x, y) => [ox + (x - pb[0]) * s, oy + (pb[3] - y) * s], from: (px, py) => ({ x: pb[0] + (px - ox) / s, y: pb[3] - (py - oy) / s }) };
  }
  function drawMinimap() {
    const c = $('#minimap'); const S = c.clientWidth; if (!S) return;
    const pr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(S * pr)) { c.width = c.height = Math.round(S * pr); }
    MM.size = S; const g = c.getContext('2d'); g.setTransform(pr, 0, 0, pr, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    if (!MM.img) { const url = A.imageURL('war3mapmap.blp'); if (url) { MM.img = new Image(); MM.img.src = url; } else MM.img = 'none'; }
    if (MM.img && MM.img !== 'none' && MM.img.complete) g.drawImage(MM.img, 0, 0, S, S);
    const M = mmMap(); const w = G.world; if (!w) return;
    for (const u of w.units) {
      if (!u.alive() || u.typeId === 'o000') continue; const [x, y] = M.to(u.x, u.y);
      const col = u.structure ? WC3_COLORS[u.owner] : G.view.teamColor(u);
      const sz = u.structure ? (isCastle(u) ? 7 : 3.4) : 2.4;
      g.fillStyle = '#000'; g.fillRect(x - sz / 2 - 0.6, y - sz / 2 - 0.6, sz + 1.2, sz + 1.2);
      g.fillStyle = col; g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    // camera box
    const q = G.view.viewQuad().map(p => M.to(p.x, p.y));
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
    // pings
    const now = performance.now();
    G.pings = (G.pings || []).filter(p => now - p.at < 3000);
    for (const p of G.pings) { const [x, y] = M.to(p.x, p.y); const t = ((now - p.at) % 1000) / 1000; g.strokeStyle = `rgba(255,220,0,${1 - t})`; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 3 + t * 12, 0, 7); g.stroke(); }
  }
  function minimapPoint(e) { const c = $('#minimap'); const b = c.getBoundingClientRect(); return mmMap().from(e.clientX - b.left, e.clientY - b.top); }

  // ---------------------------------------------------------------- top bar, timer window, messages, dialogs
  function drawClock() {
    const c = $('#clock'); const g = c.getContext('2d'); const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
    const sky = img('UI\\Console\\Human\\day-indicator-texture4.blp');
    if (sky && !sky.data && G.world) { // the sky strip scrolls with the time of day (sun - moon - sun)
      const hour = G.world.timeOfDay(); const f = ((hour + 6) % 24) / 24; const sw = sky.width / 2;
      g.save(); g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, 7); g.clip();
      const sx = f * sky.width; g.drawImage(sky, sx - sw / 2, 0, sw, sky.height, 0, 0, W, H);
      if (sx + sw / 2 > sky.width) g.drawImage(sky, sx - sw / 2 - sky.width, 0, sw, sky.height, 0, 0, W, H);
      g.restore(); return;
    }
    const hour = G.world ? G.world.timeOfDay() : 8; const night = G.world && G.world.isNight();
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, night ? '#0b1030' : '#3a6ea8'); grd.addColorStop(1, night ? '#1a1f45' : '#9cc4e4');
    g.fillStyle = grd; g.beginPath(); g.arc(W / 2, H, H - 3, Math.PI, 0); g.fill();
    const a = Math.PI + ((hour - 6 + 24) % 12) / 12 * Math.PI; const R = H - 12;
    const x = W / 2 + Math.cos(a) * R, y = H + Math.sin(a) * R;
    g.fillStyle = night ? '#e8ecff' : '#ffd84a'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    g.strokeStyle = '#b89a52'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H, H - 3, Math.PI, 0); g.stroke();
  }
  function errorMsg(t) { if (window.PyroSound) PyroSound.play('InterfaceError'); const e = $('#errmsg'); e.textContent = t; e.classList.remove('fade'); clearTimeout(errorMsg.t); errorMsg.t = setTimeout(() => e.classList.add('fade'), 2500); }
  function addMsg(text, dur) {
    const log = $('#msgs'); const d = el('div', 'msg', wc3(text)); d.dataset.until = performance.now() + Math.min(20, dur || 6) * 1000 / Math.max(1, G.speed);
    log.appendChild(d); while (log.children.length > 9) log.removeChild(log.firstChild);
    G.log.push({ t: G.world ? G.world.time : 0, text }); if (G.log.length > 400) G.log.shift();
  }
  const ERR_RE = /^(Not enough|Unable to build|Can't|Already built|Rulebreaker can only|Chaostower got disabled|Not available)/;
  function updateHud() {
    const w = G.world, r = G.rules, me = w.players[G.me];
    $('#gold').textContent = Math.floor(me.gold);
    // timer window
    let title = '', time = '';
    if (r.waveEnd && r.waveEnd > w.time) { title = r.waveTitle || 'Wave starts in'; time = fmtTime(r.waveEnd - w.time); }
    else if (r.phase === 'spawn' || r.phase === 'maze') { title = 'Round ' + r.round; time = r.phase === 'spawn' ? 'Spawning' : 'In the maze'; }
    else if (r.phase === 'fight') { title = 'Round ' + r.round; time = 'Fight!'; }
    const tw = $('#timerwin'); tw.classList.toggle('hidden', !title);
    $('#tw-title').textContent = title; $('#tw-time').textContent = time;
    // board (web-port helper: castles, races)
    for (const team of [0, 1]) {
      const c = r.castleOf(team);
      $('#cs' + team).innerHTML = c ? `${Math.round(c.hp)} <small>/ ${Math.round(c.maxHp())}</small>` : '<small>destroyed</small>';
      $('#rc' + team).textContent = r.race[team] ? r.RACES[r.race[team]].name : '';
    }
    $('#bround').textContent = r.round; $('#bmode').textContent = r.goldMode ? 'Gold Mode' : 'Standard';
    // messages
    while (G.msgSeen < w.messages.length) {
      const m = w.messages[G.msgSeen++];
      if (m.players && !m.players.includes(G.me)) continue;
      if (m.players && ERR_RE.test(m.text)) { errorMsg(m.text.replace(/\.?$/, '.')); continue; }
      addMsg(m.text, m.dur);
    }
    const now = performance.now();
    for (const d of [...$('#msgs').children]) if (now > +d.dataset.until) d.classList.add('fade');
    updateDialog();
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === G.speed && !w.paused));
    $('#pausebtn').classList.toggle('on', !!w.paused);
    // queued builds of my builder
    const b = myBuilder(); G.view.setQueueMarks(b && b.alive() ? b.buildQueue : []);
  }
  let dialogKey = '';
  function updateDialog() {
    const r = G.rules, w = G.world; const box = $('#dialog');
    let key = '';
    if (r.dialog && r.dialog.votes[G.me] == null) key = 'v:' + r.dialog.key;
    else if (r.raceVote && !r.raceVote.votes[G.me] && !r.raceVote.done[w.players[G.me].team]) key = 'race';
    else if (G.rangeDialog) key = 'range';
    if (key !== dialogKey) {
      dialogKey = key; hideTip(); box.innerHTML = ''; box.classList.toggle('hidden', !key);
      const btn = (label, fn, hk) => { const b = el('button', 'dbtn', wc3(label)); b.onclick = fn; if (hk) b.dataset.hk = hk; box.appendChild(b); return b; };
      if (key.startsWith('v:')) {
        box.appendChild(el('div', 'dtitle', wc3(r.dialog.title)));
        r.dialog.options.forEach((o, i) => btn(o, () => w.command({ pid: G.me, type: 'vote', option: i })));
        box.appendChild(el('div', 'dtime', ''));
      } else if (key === 'race') {
        box.appendChild(el('div', 'dtitle', 'Choose your race'));
        for (const [k, v] of Object.entries(r.RACES)) {
          const b = btn(`|cff${v.color.replace('#', '').padStart(6, '0').slice(-6)}${v.name}|r`, () => { hideTip(); w.command({ pid: G.me, type: 'raceVote', race: k }); });
          const parts = [v.castle, v.tower].map(id => D.units[id]).filter(Boolean);
          b.onmouseenter = () => showTip({ title: v.name, tip: parts.map(d => `|cffffcc00${d.name}|r|n` + ((D.abilities[d.abil.find(a => D.abilities[a] && /Info/.test(D.abilities[a].name))] || { tips: [''] }).tips[0] || '')).join('|n|n') }, b);
          b.onmouseleave = hideTip;
        }
        box.appendChild(el('div', 'dtime', ''));
      } else if (key === 'range') {
        box.appendChild(el('div', 'dtitle', 'Show range'));
        for (const [label, rng] of [['Short Aura: 120', 120], ['Smith/Miner: 500', 500], ['Chain: 550', 550], ['Frost/Casino: 600', 600], ['Priest/RB/Witch Doctor: 650', 650], ['Trainer: 750', 750], ['Chaos: 800', 800], ['Long Aura: 900', 900]])
          btn(label, () => { G.view.showRange(G.rangeAt.x, G.rangeAt.y, rng, 5); G.rangeDialog = false; });
        btn('Cancel', () => { G.rangeDialog = false; });
      }
    }
    const t = box.querySelector('.dtime');
    if (t) t.textContent = key === 'race' ? fmtTime(r.raceVote.end - w.time) : r.dialog ? fmtTime(r.dialog.end - w.time) : '';
  }
  function showRangeDialog() { G.rangeDialog = true; }
  function showGameOver(o) {
    const w = G.world; const myTeam = w.players[G.me].team; const won = o.winner === myTeam;
    if (window.PyroSound) PyroSound.playMusic(won ? 'victory' : 'defeat');
    const box = $('#over'); box.classList.remove('hidden');
    box.innerHTML = `<div class="wcbox center"><div class="dtitle big">${won ? 'Victory!' : 'Defeat!'}</div><div class="dsub">${won ? 'The enemy castle fell in round ' : 'Your castle fell in round '}${o.round}.</div>
      <button class="dbtn" id="ov-cont">Continue watching</button><button class="dbtn" id="ov-quit">Quit to lobby</button></div>`;
    $('#ov-cont').onclick = () => box.classList.add('hidden');
    $('#ov-quit').onclick = () => { box.classList.add('hidden'); showLobby(); };
  }

  // ---------------------------------------------------------------- menus (F9 quests, F10 menu, F11 allies, F12 log)
  function openPanel(which) {
    const box = $('#panel'); const w = G.world;
    if (!which || box.dataset.which === which && !box.classList.contains('hidden')) { box.classList.add('hidden'); box.dataset.which = ''; return; }
    box.dataset.which = which; box.classList.remove('hidden'); let h = '';
    if (which === 'quests') {
      const items = [['Commands', D.texts.commands], ['Patchnotes', D.texts.patchnotes], ['Special Thanks', D.texts.thanks], ['Models', D.texts.models], ['Discord', D.texts.discord],
        ['About this web port', 'Rules, numbers and the map layout come from Pyro TD 0.31. Models that are not available yet are drawn with a stand-in model (hover a unit or check the info panel to see which model it should be). Placeholder icons show the name of the missing icon file. Computer players are new; the original bots were empty.']];
      h = `<div class="ptitle">Quests</div><div class="qwrap"><div class="qlist">${items.map((q, i) => `<div class="qi${i ? '' : ' on'}" data-i="${i}">${esc(q[0])}</div>`).join('')}</div><div class="qbody" id="qbody">${wc3(items[0][1] || '')}</div></div>`;
      box.innerHTML = h + '<button class="dbtn small" data-close>OK</button>';
      box.querySelectorAll('.qi').forEach(q => q.onclick = () => { box.querySelectorAll('.qi').forEach(x => x.classList.remove('on')); q.classList.add('on'); $('#qbody').innerHTML = wc3(items[+q.dataset.i][1] || ''); });
    } else if (which === 'menu') {
      box.innerHTML = `<div class="ptitle">Menu</div>
        <button class="dbtn" data-act="resume">Return to Game</button>
        <button class="dbtn" data-act="pause">${w && w.paused ? 'Resume' : 'Pause'} Game</button>
        <div class="optrow"><label>Build grid</label><select data-opt="grid"><option value="tile">Lock to terrain tiles (128)</option><option value="fine">Fine, like WC3 (32)</option></select></div>
        <div class="optrow"><label>Edge scrolling</label><input type="checkbox" data-opt="edgePan"></div>
        <div class="optrow"><label>Show all model labels</label><input type="checkbox" data-opt="labels"></div>
        <div class="optrow"><label>Health bars</label><input type="checkbox" data-opt="bars"></div>
        <div class="optrow"><label>Sound volume</label><input type="range" min="0" max="1" step="0.05" data-snd="sound"></div>
        <div class="optrow"><label>Music volume</label><input type="range" min="0" max="1" step="0.05" data-snd="music"></div>
        <button class="dbtn" data-act="restart">Restart</button>
        <button class="dbtn" data-act="quit">Quit to Lobby</button>`;
      box.querySelector('[data-opt="grid"]').value = G.opts.grid;
      box.querySelectorAll('input[data-opt]').forEach(i => { i.checked = !!G.opts[i.dataset.opt]; });
      box.querySelectorAll('[data-opt]').forEach(i => i.onchange = () => { G.opts[i.dataset.opt] = i.type === 'checkbox' ? i.checked : i.value; applyOpts(); saveOpts(); });
      box.querySelectorAll('[data-snd]').forEach(i => { const S = window.PyroSound; if (!S) return; i.value = S.opts[i.dataset.snd]; i.oninput = () => S.setOpts({ [i.dataset.snd]: +i.value, enabled: true }); });
      box.querySelector('[data-act="resume"]').onclick = () => openPanel(null);
      box.querySelector('[data-act="pause"]').onclick = () => { togglePause(); openPanel(null); };
      box.querySelector('[data-act="restart"]').onclick = () => { openPanel(null); if (window.PyroNet && PyroNet.role) { addMsg('Restart is only available in single player.', 4); return; } if (G.lastCfg) startGame(G.lastCfg); };
      box.querySelector('[data-act="quit"]').onclick = () => { openPanel(null); showLobby(); };
    } else if (which === 'allies') {
      const rows = w.players.filter(p => p.playing).map(p => `<tr><td><span class="sw" style="background:${WC3_COLORS[p.id]}"></span>${esc(p.name || COLOR_NAMES[p.id])}</td><td>${p.id < 2 ? 'Castle' : 'Team ' + (TEAM_OF[p.id] + 1)}</td><td>${w.ally(p.id, G.me) ? Math.floor(p.gold) : '—'}</td><td>${p.kind === 'human' ? 'Player' : 'Computer'}</td></tr>`).join('');
      box.innerHTML = `<div class="ptitle">Allies</div><table class="atable"><tr><th>Player</th><th>Team</th><th>Gold</th><th></th></tr>${rows}</table><button class="dbtn small" data-close>OK</button>`;
    } else if (which === 'log') {
      box.innerHTML = `<div class="ptitle">Message Log</div><div class="logbody">${G.log.slice(-200).map(m => `<div><span class="lt">[${fmtTime(m.t)}]</span> ${wc3(m.text)}</div>`).join('')}</div><button class="dbtn small" data-close>OK</button>`;
      const lb = box.querySelector('.logbody'); lb.scrollTop = lb.scrollHeight;
    }
    box.querySelectorAll('[data-close]').forEach(b => b.onclick = () => openPanel(null));
  }
  function applyOpts() { if (!G.view) return; G.view.labelsAll = G.opts.labels; G.view.showBars = G.opts.bars; }

  // ---------------------------------------------------------------- chat ("-unstuck", "-zoom X")
  function openChat() { const c = $('#chat'); c.classList.remove('hidden'); G.chatOpen = true; const i = $('#chatin'); i.value = ''; i.focus(); }
  function closeChat() { $('#chat').classList.add('hidden'); G.chatOpen = false; $('#chatin').blur(); }
  function submitChat() {
    const t = $('#chatin').value.trim(); closeChat(); if (!t) return;
    const m = /^-(z|zoom)\s+(\d+)/i.exec(t);
    if (m) { G.camDist = Math.max(2000, Math.min(4000, +m[2])); return; }
    if (/^-unstuck/i.test(t)) { G.world.command({ pid: G.me, type: 'unstuck' }); return; }
    if (/^-getcontrol/i.test(t)) { addMsg('Players who leave are taken over by a computer player automatically.', 4); return; }
    G.world.command({ pid: G.me, type: 'chat', text: t });
  }

  // ---------------------------------------------------------------- input
  function setupInput() {
    const gl = $('#gl'); let drag = null; let mmDown = 0;
    gl.addEventListener('contextmenu', e => e.preventDefault());
    $('#console').addEventListener('contextmenu', e => e.preventDefault());
    gl.addEventListener('mousedown', e => {
      if (!G.world) return;
      if (e.button === 1) { drag = { x: e.clientX, y: e.clientY, cx: G.view.cam.x, cy: G.view.cam.y }; e.preventDefault(); return; }
      if (e.clientY > G.view.H) return;
      if (e.button === 0) clickWorld(e, e.clientX, e.clientY);
      if (e.button === 2) rightClickWorld(e.clientX, e.clientY);
    });
    addEventListener('mousemove', e => {
      G.mouse.x = e.clientX; G.mouse.y = e.clientY; G.mouse.inside = true;
      if (drag) { const k = G.view.cam.dist / 1100; G.view.cam.x = drag.cx - (e.clientX - drag.x) * k; G.view.cam.y = drag.cy + (e.clientY - drag.y) * k * 1.4; }
      if (mmDown === 1) { const p = minimapPoint(e); G.view.cam.x = p.x; G.view.cam.y = p.y; }
    });
    document.addEventListener('mouseleave', () => { G.mouse.inside = false; });
    addEventListener('blur', () => { G.mouse.inside = false; G.keys = {}; });
    addEventListener('mouseup', () => { drag = null; mmDown = 0; });
    gl.addEventListener('wheel', e => { e.preventDefault(); G.camDist = Math.max(1200, Math.min(4500, G.camDist * (e.deltaY > 0 ? 1.1 : 1 / 1.1))); }, { passive: false });
    const mm = $('#minimap');
    mm.addEventListener('mousedown', e => {
      if (!G.world) return; e.preventDefault(); const p = minimapPoint(e);
      if (e.button === 0) {
        if (G.mode && G.mode.kind === 'point') { const b = myBuilder(); if (b) G.world.command({ pid: G.me, type: 'move', unit: b.id, x: p.x, y: p.y }); setMode(null); return; }
        mmDown = 1; G.view.cam.x = p.x; G.view.cam.y = p.y;
      } else if (e.button === 2) { const b = myBuilder(); const u = selUnit(); if (b && u && u.id === b.id) G.world.command({ pid: G.me, type: 'move', unit: b.id, x: p.x, y: p.y }); }
    });
    mm.addEventListener('contextmenu', e => e.preventDefault());
    $('#mm-ping').onclick = () => { G.pings = G.pings || []; G.pings.push({ x: G.view.cam.x, y: G.view.cam.y, at: performance.now() }); if (window.PyroSound) PyroSound.play('MapPing'); };
    $('#mm-home').onclick = () => jumpHome();
    $('#mm-labels').onclick = () => { G.opts.labels = !G.opts.labels; applyOpts(); saveOpts(); $('#mm-labels').classList.toggle('on', G.opts.labels); };
    $('#mm-sound').onclick = () => { const S = window.PyroSound; if (!S) return; S.setOpts({ enabled: !S.opts.enabled }); $('#mm-sound').classList.toggle('on', S.opts.enabled); };
    addEventListener('keydown', e => {
      if (!G.world || $('#lobby').offsetParent || $('#loading').offsetParent) return;
      if (G.chatOpen) { if (e.key === 'Enter') submitChat(); else if (e.key === 'Escape') closeChat(); return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const k = e.key;
      if (k.startsWith('Arrow')) { G.keys[k] = true; e.preventDefault(); return; }
      if (k === 'Enter') { openChat(); e.preventDefault(); return; }
      if (k === 'F9') { openPanel('quests'); e.preventDefault(); return; }
      if (k === 'F10') { openPanel('menu'); e.preventDefault(); return; }
      if (k === 'F11') { openPanel('allies'); e.preventDefault(); return; }
      if (k === 'F12') { openPanel('log'); e.preventDefault(); return; }
      if (k === 'F1') { const b = myBuilder(); if (b) { if (G.sel === b.id) { G.view.cam.x = b.x; G.view.cam.y = b.y; } G.sel = b.id; G.submenu = null; } e.preventDefault(); return; }
      if (k === ' ') { jumpHome(); e.preventDefault(); return; }
      if (k === 'Pause') { togglePause(); return; }
      if (G.rangeDialog && k === 'Escape') { G.rangeDialog = false; return; }
      if (!$('#panel').classList.contains('hidden') && k === 'Escape') { openPanel(null); return; }
      // command card hotkeys
      const hk = k === 'Escape' ? 'Escape' : k.length === 1 ? k.toUpperCase() : '';
      if (hk) {
        const b = cardBtns.find(b => b && !b.passive && b.hotkey && b.hotkey.toUpperCase() === hk.toUpperCase());
        if (b) { pressButton(b); e.preventDefault(); return; }
        if (k === 'Escape') { if (G.mode) setMode(null); else if (G.submenu) G.submenu = null; cardKey = ''; }
      }
    });
    addEventListener('keyup', e => { G.keys[e.key] = false; });
    document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { if (isClient()) return; G.speed = +b.dataset.speed; if (G.world) G.world.paused = false; });
    $('#pausebtn').onclick = togglePause;
    $('#tb-quests').onclick = () => openPanel('quests'); $('#tb-menu').onclick = () => openPanel('menu');
    $('#tb-allies').onclick = () => openPanel('allies'); $('#tb-log').onclick = () => openPanel('log');
    $('#board-h').onclick = () => $('#board').classList.toggle('min');
  }
  const isClient = () => window.PyroNet && PyroNet.role === 'client' && PyroNet.started;
  function togglePause() { if (G.world && !isClient()) { G.world.paused = !G.world.paused; if (window.PyroSound) PyroSound.play('PauseGame'); } }
  function cameraKeys(dt) {
    const c = G.view.cam; const sp = c.dist * 0.9 * dt; let dx = 0, dy = 0;
    if (G.keys.ArrowLeft) dx -= 1; if (G.keys.ArrowRight) dx += 1; if (G.keys.ArrowUp) dy += 1; if (G.keys.ArrowDown) dy -= 1;
    if (G.opts.edgePan && G.mouse.inside && document.hasFocus() && !G.chatOpen) {
      const m = 4; if (G.mouse.x <= m) dx -= 1; if (G.mouse.x >= innerWidth - m - 1) dx += 1; if (G.mouse.y <= m) dy += 1; if (G.mouse.y >= innerHeight - m - 1) dy -= 1;
    }
    c.x += dx * sp; c.y += dy * sp;
    c.dist += (G.camDist - c.dist) * Math.min(1, dt * 8);
  }

  // ---------------------------------------------------------------- main loop
  function frame(ts) {
    const dtReal = Math.min(0.25, (ts - (G.last || ts)) / 1000); G.last = ts;
    const w = G.world;
    if (w && G.inGame) {
      const N = window.PyroNet; let alphaNet = null;
      if (N && N.role === 'client' && N.started) { // clients replay the host's ticks
        const r = N.clientStep(w, dtReal); alphaNet = r.alpha; G.speed = N.hostSpeed; w.paused = N.hostPaused;
      } else if (!w.paused) {
        G.acc += dtReal * G.speed; let n = 0; const batch = []; const first = w.tick;
        while (G.acc >= DT && n < 400) { if (N && N.role === 'host') batch.push(w.queue.map(c => Object.assign({}, c))); w.step(); if (N && N.role === 'host') N.noteHash(w); G.acc -= DT; n++; }
        if (n >= 400) G.acc = 0;
        if (N && N.role === 'host' && batch.length) N.hostTicks(batch, first, G.speed, false);
      } else if (N && N.role === 'host' && (G.fc || 0) % 30 === 0) N.hostTicks([], w.tick, G.speed, true);
      cameraKeys(dtReal);
      // hover
      if (G.mouse.inside && G.mouse.y < G.view.H && !G.mouseOverUI) {
        G.hover = G.view.groundAt(G.mouse.x, G.mouse.y);
        const hu = G.mode && G.mode.kind === 'build' ? null : G.view.pick(G.mouse.x, G.mouse.y); G.view.hovered = hu ? hu.id : null;
      } else G.view.hovered = null;
      updatePlacement();
      G.view.selected = G.sel;
      const alpha = alphaNet != null ? alphaNet : w.paused ? 1 : Math.min(1, G.acc / DT);
      const animDt = w.paused ? 0 : dtReal * 1000 * G.speed;
      G.view.frame(animDt, alpha);
      const pr = $('#portrait').getBoundingClientRect();
      G.view.renderPortrait({ x: pr.left + 3, y: pr.top + 3, w: pr.width - 6, h: pr.height - 6 }, selUnit(), animDt);
      drawMinimap(); updateHud(); renderCard(); renderInfo(); checkTip();
      if ((G.fc = (G.fc || 0) + 1) % 15 === 0) drawClock();
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- lobby & loading screen
  const SLOT_DEFAULT = { 2: 'human', 3: 'ai', 4: 'closed', 5: 'closed', 6: 'ai', 7: 'ai', 8: 'closed', 9: 'closed' };
  const N = () => window.PyroNet;
  function lobbySlots() { // current slot table from the controls (single player / host)
    return [...$('#lb-slots').querySelectorAll('[data-slot]')].map(e => {
      const id = +e.dataset.slot; const net = N() && N().role === 'host' ? N().lobby.slots.find(x => x.id === id) : null;
      if (net && net.kind === 'human') return { id, kind: 'human', name: net.name };
      return { id, kind: e.tagName === 'SELECT' ? e.value : e.dataset.kind, name: e.tagName === 'SELECT' && e.value === 'human' ? ($('#lb-name').value || 'You') : '' };
    });
  }
  function renderSlots(netLobby, myPid) {
    const box = $('#lb-slots'); box.innerHTML = ''; const role = N() && N().role;
    for (const team of [0, 1]) {
      box.appendChild(el('div', 'lteam', team === 0 ? 'Team 1 (north)' : 'Team 2 (south)'));
      for (const id of team === 0 ? [2, 3, 4, 5] : [6, 7, 8, 9]) {
        const row = el('div', 'lslot'); row.appendChild(el('span', 'sw')).style.background = WC3_COLORS[id];
        const ns = netLobby ? netLobby.slots.find(x => x.id === id) : null;
        if (role === 'client') { // read-only list; open slots can be taken
          const n = el('div', 'lname' + (ns.kind === 'open' ? ' open' : ''), esc(ns.kind === 'human' ? ns.name + (id === myPid ? ' (you)' : '') : ns.kind === 'ai' ? 'Computer' : ns.kind === 'open' ? 'Open' : 'Closed'));
          n.dataset.slot = id; n.dataset.kind = ns.kind; row.appendChild(n);
          if (ns.kind === 'open') { const t = el('button', 'ltake', 'Take'); t.onclick = () => N().host.send({ t: 'slot', id }); row.appendChild(t); }
        } else if (ns && ns.kind === 'human' && ns.peer !== 'host') { // a joined player
          const n = el('div', 'lname', esc(ns.name)); n.dataset.slot = id; n.dataset.kind = 'human'; row.appendChild(n);
        } else {
          const sel = el('select'); sel.dataset.slot = id;
          sel.innerHTML = role === 'host' ? '<option value="human">You</option><option value="open">Open</option><option value="ai">Computer</option><option value="closed">Closed</option>'
            : '<option value="human">You</option><option value="ai">Computer</option><option value="closed">Closed</option>';
          sel.value = ns ? (ns.kind === 'human' ? 'human' : ns.kind) : (box.dataset[id] || SLOT_DEFAULT[id]);
          sel.onchange = () => {
            if (sel.value === 'human') box.querySelectorAll('select').forEach(o => { if (o !== sel && o.value === 'human') o.value = role === 'host' ? 'open' : 'ai'; });
            if (![...box.querySelectorAll('select')].some(o => o.value === 'human')) sel.value = 'human';
            if (role === 'host') { const sl = lobbySlots(); N().lobby.slots.forEach(x => { const c = sl.find(y => y.id === x.id); if (x.kind !== 'human' || x.peer === 'host') { x.kind = c.kind; x.name = c.kind === 'human' ? N().name : ''; x.peer = c.kind === 'human' ? 'host' : null; } }); N().pushLobby(); }
          };
          row.appendChild(sel);
        }
        row.appendChild(el('span', 'lcol', COLOR_NAMES[id]));
        box.appendChild(row);
      }
    }
    $('#lb-start').disabled = role === 'client';
    $('#lb-start').textContent = role === 'client' ? 'Waiting for the host...' : 'Start Game';
  }
  function setupLobby() {
    $('#lb-title').innerHTML = wc3(D.texts.title || 'Pyro TD 0.31');
    $('#lb-desc').innerHTML = wc3(D.texts.description || '');
    $('#lb-author').innerHTML = wc3(D.texts.author || '');
    const url = A.imageURL('war3mapmap.blp'); if (url) $('#lb-preview').src = url;
    try { const n = localStorage.getItem('pyro.name'); if (n) $('#lb-name').value = n; } catch (e) { /* ignore */ }
    $('#lb-name').onchange = () => { try { localStorage.setItem('pyro.name', $('#lb-name').value); } catch (e) { /* ignore */ } };
    renderSlots(null);
    const net = N(); const status = (t) => { $('#lb-status').textContent = t; };
    net.onStatus = status;
    net.onLobby = (lobby, you) => { renderSlots(lobby, you); if (net.role === 'host') $('#lb-code').textContent = net.code; };
    net.onStart = (cfg) => startGame(cfg);
    net.onHostLost = () => { if (G.inGame) addMsg('|cffff4040The host left the game.|r', 15); };
    net.onDesync = (tick) => addMsg(`|cffff8040Warning: the game went out of sync at tick ${tick}. Please report what happened just before.|r`, 20);
    $('#lb-host').onclick = () => {
      if (!net.available()) { status('Multiplayer needs the PeerJS library (lib/peerjs.min.js).'); return; }
      const name = $('#lb-name').value || 'Host';
      const sl = lobbySlots().map(x => ({ id: x.id, kind: x.kind === 'closed' ? 'open' : x.kind, name: x.name })); // closed slots open up for friends
      net.hostGame(name, sl);
      $('#lb-code').textContent = '…'; $('#lb-leave').classList.remove('hidden'); $('#lb-join').disabled = true; $('#lb-host').disabled = true;
      renderSlots(net.lobby);
    };
    $('#lb-join').onclick = () => {
      if (!net.available()) { status('Multiplayer needs the PeerJS library (lib/peerjs.min.js).'); return; }
      const code = $('#lb-joincode').value.trim(); if (code.length < 4) { status('Type the room code first.'); return; }
      net.join(code, $('#lb-name').value || 'Player'); $('#lb-leave').classList.remove('hidden'); $('#lb-host').disabled = true; $('#lb-join').disabled = true;
    };
    $('#lb-leave').onclick = () => { net.close(); $('#lb-code').textContent = ''; status('Left the room.'); $('#lb-leave').classList.add('hidden'); $('#lb-host').disabled = false; $('#lb-join').disabled = false; renderSlots(null); };
    $('#lb-start').onclick = () => {
      if (net.role === 'client') return;
      const sl = lobbySlots();
      const me = sl.find(s => s.kind === 'human' && (net.role !== 'host' || (net.lobby.slots.find(x => x.id === s.id) || {}).peer === 'host' || !net.lobby.slots.find(x => x.id === s.id && x.peer && x.peer !== 'host')));
      if (!me) { $('#lb-err').textContent = 'Pick a slot for yourself.'; return; }
      const active = sl.filter(s => s.kind === 'human' || s.kind === 'ai');
      const t1 = active.filter(s => s.id <= 5).length, t2 = active.filter(s => s.id >= 6).length;
      if (!t1 || !t2) { $('#lb-err').textContent = 'Each team needs at least one player.'; return; }
      $('#lb-err').textContent = '';
      const cfg = { slots: sl.map(s => s.kind === 'open' ? Object.assign(s, { kind: 'closed' }) : s), me: me.id, name: $('#lb-name').value || 'You',
        seed: +$('#lb-seed').value || ((Date.now() * 2654435761) >>> 0) % 16777216, perTeam: Math.max(t1, t2), team: TEAM_OF[me.id] };
      if (net.role === 'host') net.startAsHost(cfg);
      startGame(cfg);
    };
  }
  function showLobby() {
    G.inGame = false; setMode(null); if (window.PyroSound) PyroSound.playMusic(null);
    if (window.PyroNet && PyroNet.started) { PyroNet.close(); $('#lb-code').textContent = ''; $('#lb-leave').classList.add('hidden'); $('#lb-host').disabled = false; $('#lb-join').disabled = false; renderSlots(null); }
    $('#lobby').classList.remove('hidden'); $('#hud').classList.add('hidden');
  }
  function loadingComposite() { // the map's loading screen (4 BLPs: 512x512 top, 512x256 bottom)
    const c = document.createElement('canvas'); const g = c.getContext('2d'); c.width = 1024; c.height = 768;
    g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 768); let any = false;
    const parts = [['loadingscreentl.blp', 0, 0], ['loadingscreentr.blp', 512, 0], ['loadingscreenbl.blp', 0, 512], ['loadingscreenbr.blp', 512, 512]];
    for (const [f, x, y] of parts) { const im = A.image(f); if (!im) continue; any = true;
      if (im.data) { const t = document.createElement('canvas'); t.width = im.width; t.height = im.height; t.getContext('2d').putImageData(im, 0, 0); g.drawImage(t, x, y, 512, im.height === 256 ? 256 : 512); }
      else g.drawImage(im, x, y, 512, im.height === 256 ? 256 : 512); }
    return any ? c : null;
  }
  function loadingScreen() { const c = $('#ls-canvas'); const src = loadingComposite(); c.width = 1024; c.height = 768; if (src) c.getContext('2d').drawImage(src, 0, 0); }
  function startGame(cfg) {
    G.lastCfg = cfg; G.inGame = false;
    $('#lobby').classList.add('hidden'); $('#loading').classList.remove('hidden'); $('#hud').classList.add('hidden');
    if (!G.lsDrawn) { loadingScreen(); G.lsDrawn = true; }
    if (window.PyroSound) PyroSound.play('GlueScreenClick');
    const bar = $('#ls-bar'); let p = 0;
    const steps = [() => { newGame(cfg); }, () => { warmModels(); }, () => {}, () => {}];
    const tick = () => {
      if (p < steps.length) { steps[p](); p++; bar.style.width = (p / steps.length * 100) + '%'; setTimeout(tick, 120); return; }
      $('#loading').classList.add('hidden'); $('#hud').classList.remove('hidden'); layout(); applyOpts();
      G.inGame = true; G.last = 0; cardKey = ''; infoKey = '';
      addMsg(`|cffffcc00${D.texts.title || 'Pyro TD'}|r — test build. Press |cffffcc00F9|r for quests, |cffffcc00F10|r for the menu.`, 10);
      const net = window.PyroNet; $('#netinfo').textContent = net && net.role ? (net.role === 'host' ? `Hosting room ${net.code}` : `In room ${net.code}`) : '';
      document.querySelectorAll('#testbar button').forEach(b => { b.disabled = isClient(); });
      const missing = countStandins(); if (missing) addMsg(`${missing} unit models are not in the asset packs yet and use stand-ins (shown as "(stand-in)" when hovered).`, 10);
    };
    setTimeout(tick, 60);
  }
  function warmModels() { for (const id of Object.keys(D.units)) try { resolve(D.units[id]); } catch (e) { console.warn('model', id, e); } }
  function countStandins() { let n = 0; for (const id of Object.keys(D.units)) { const d = D.units[id]; if (!/[a-z]/i.test(String(d.model || '').replace(/\.md[lx]$/i, ''))) continue; if (resolve(d).standin) n++; } return n; }

  // ---------------------------------------------------------------- boot
  window.addEventListener('load', async () => {
    const bar = $('#boot-bar');
    await A.ready((f) => { bar.style.width = Math.round(f * 100) + '%'; });
    await loadFont();
    buildSkin();
    G.view = new View($('#gl'), $('#ov'));
    if (document.fonts && document.fonts.check && document.fonts.check('12px Friz')) G.view.font = 'Friz, Georgia, serif';
    setupInput(); setupLobby(); layout(); applyOpts();
    $('#mm-labels').classList.toggle('on', !!G.opts.labels); $('#mm-sound').classList.toggle('on', !window.PyroSound || PyroSound.opts.enabled);
    addEventListener('resize', () => { layout(); cardKey = ''; });
    $('#console').addEventListener('mouseenter', () => { G.mouseOverUI = true; });
    $('#console').addEventListener('mouseleave', () => { G.mouseOverUI = false; });
    $('#boot').classList.add('hidden'); $('#lobby').classList.remove('hidden');
    requestAnimationFrame(frame);
    if (/[?&]autostart/.test(location.search)) $('#lb-start').click();
  });
})();
