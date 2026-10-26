/* 3D world view: keeps a three.js scene in sync with the simulation (units, missiles, effects),
 * plays Warcraft model animations (with their particles, ribbons and sound events), draws shadows,
 * selection circles, building splats, buff effects, missiles and spell effects with the real models,
 * health bars / floating text on an overlay canvas, the portrait, and handles picking.
 * Models that aren't available are drawn with a stand-in model and labelled with the real name.
 */
(function () {
  'use strict';
  const D = window.PYRO_DATA; const A = window.PyroAssets; const MDX = window.PyroMDX; const TR = window.PyroTerrain;
  const GF = window.PYRO_GAMEFILES || {};
  const WC3_COLORS = ['#ff0303', '#0042ff', '#1ce6b9', '#540081', '#fffc00', '#fe8a0e', '#20c000', '#e55bb0', '#959697', '#7ebff1'];
  const AOA = 56 * Math.PI / 180;
  const snd = () => window.PyroSound;

  // ---------------------------------------------------------------- model resolution / stand-ins
  const CASTLES = ['h001', 'h011', 'h013', 'h015', 'h017'];
  const RANGED = ['h00N', 'u000', 'u002', 'u003'];
  function standinFor(def) {
    if (CASTLES.includes(def.id)) return { path: 'pyro\\standin\\castle.mdx', fit: 'width', size: 330 };
    if (def.structure) return { path: 'war3mapimported\\beer keg v2.mdx', fit: 'width', size: 112 };
    if (def.id === 'o000') return { path: 'war3mapimported\\beer.mdx', fit: 'height', size: 70 };
    if (RANGED.includes(def.id)) return { path: 'war3mapimported\\bloodelfmage.mdx', fit: 'height', size: 150 };
    return { path: 'war3mapimported\\orc warlock.mdx', fit: 'height', size: 135 };
  }
  const resolved = new Map();
  function resolve(def) {
    if (resolved.has(def.id)) return resolved.get(def.id);
    let r;
    const md = def.model && A.hasModel(def.model) ? MDX.load(def.model) : null;
    if (md) r = { md, scale: def.scale || 1, standin: false, path: A.modelKey(def.model) };
    else {
      const s = standinFor(def); const smd = MDX.load(s.path);
      let scale = 1;
      if (smd) {
        const e = smd.body; const w = Math.max(e.max[0] - e.min[0], e.max[1] - e.min[1]); const h = e.max[2] - Math.max(0, e.min[2]);
        scale = s.size / Math.max(1, s.fit === 'width' ? w : h);
        if (!def.structure) scale *= (def.scale || 1);
      }
      r = { md: smd, scale, standin: true, path: A.modelKey(def.model) || '(no model)' };
    }
    r.props = String(def.animProps || '').split(',').map(x => x.trim()).filter(Boolean);
    resolved.set(def.id, r); return r;
  }
  function portraitModel(def) {
    const r = resolve(def); if (!r.md) return r;
    if (!r.standin) { const p = r.path.replace(/\.mdx$/, '_portrait.mdx'); if (A.hasModel(p)) return { md: MDX.load(p), scale: 1, standin: false, portrait: true, props: r.props }; }
    return r;
  }

  // ---------------------------------------------------------------- effect models
  const FX = {
    evolve: 'Abilities\\Spells\\Demon\\DarkPortal\\DarkPortalTarget.mdl', // trigger "evolution new"
    teleport: 'Abilities\\Spells\\Human\\MassTeleport\\MassTeleportTarget.mdl',
    full: 'Abilities\\Spells\\Items\\AIil\\AIilTarget.mdl',
    blizzard: 'Abilities\\Spells\\Human\\Blizzard\\BlizzardTarget.mdl',
    meteor: 'Units\\Demon\\Infernal\\InfernalBirth.mdl',
    stomp: 'Abilities\\Spells\\Orc\\WarStomp\\WarStompCaster.mdl',
    heal: 'Abilities\\Spells\\Human\\HolyBolt\\HolyBoltSpecialArt.mdl', // trigger "healthpack"
    summon: 'Abilities\\Spells\\Orc\\FeralSpirit\\feralspirittarget.mdl',
    link: 'Abilities\\Spells\\Orc\\SpiritLink\\SpiritLinkTarget.mdl',
    reincarnate: 'Abilities\\Spells\\Orc\\Reincarnation\\ReincarnationTarget.mdl',
    quake: 'Abilities\\Spells\\Undead\\Impale\\ImpaleHitTarget.mdl',
    lasthope: 'Abilities\\Spells\\Items\\AIem\\AIemTarget.mdl', // trigger "last hope castle": 8 around the castle
  };
  const LASTHOPE_OFFSETS = [[180, 0], [90, 90], [0, 180], [-90, -90], [-180, 0], [-90, 90], [0, -180], [90, -90]];
  const BUFF_FX = { // buff id -> [model, attachment]
    divine: ['Abilities\\Spells\\Human\\DivineShield\\DivineShieldTarget.mdl', 'origin'],
    invuln: ['Abilities\\Spells\\Human\\DivineShield\\DivineShieldTarget.mdl', 'origin'],
    frost: ['Abilities\\Spells\\Other\\FrostDamage\\FrostDamage.mdl', 'chest'],
    link: ['Abilities\\Spells\\Orc\\SpiritLink\\SpiritLinkTarget.mdl', 'chest'],
    lust: ['Abilities\\Spells\\Orc\\Bloodlust\\BloodlustTarget.mdl', 'hand left'],
    lust2: ['Abilities\\Spells\\Orc\\Bloodlust\\BloodlustTarget.mdl', 'hand right'],
    stun: ['Abilities\\Spells\\Human\\Thunderclap\\ThunderclapTarget.mdl', 'overhead'],
    aura: ['Abilities\\Spells\\Other\\GeneralAuraTarget\\GeneralAuraTarget.mdl', 'origin'],
  };
  const FIRE_FX = { small: ['Environment\\SmallBuildingFire\\SmallBuildingFire0.mdl', 'Environment\\SmallBuildingFire\\SmallBuildingFire1.mdl', 'Environment\\SmallBuildingFire\\SmallBuildingFire2.mdl'],
    large: ['Environment\\LargeBuildingFire\\LargeBuildingFire0.mdl', 'Environment\\LargeBuildingFire\\LargeBuildingFire1.mdl', 'Environment\\LargeBuildingFire\\LargeBuildingFire2.mdl'] };

  // ---------------------------------------------------------------- decal helpers
  const decalMats = new Map();
  function decalMaterial(path, color, opacity, additive) {
    const key = path + '|' + color + '|' + additive;
    if (decalMats.has(key)) return decalMats.get(key).clone();
    const map = path ? A.texture(path, 3) : null;
    const m = new THREE.MeshBasicMaterial({ map, color: color != null ? color : 0xffffff, transparent: true, opacity: opacity != null ? opacity : 1, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    decalMats.set(key, m); return m.clone();
  }
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  // ---------------------------------------------------------------- view
  class View {
    constructor(canvas, overlay) {
      this.canvas = canvas; this.overlay = overlay; this.octx = overlay.getContext('2d');
      const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.autoClear = false;
      this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#000000');
      this.camera = new THREE.PerspectiveCamera(46, 1, 50, 14000); this.camera.up.set(0, 0, 1);
      this.ambient = new THREE.AmbientLight(0xffffff, 0.55); this.sun = new THREE.DirectionalLight(0xffffff, 0.75);
      this.sun.position.set(-1600, -1800, 3000); this.scene.add(this.ambient, this.sun, this.sun.target);
      this.terrain = TR.build(this.scene);
      this.groundMeshes = []; this.terrain.traverse(o => { if (o.isMesh && o.userData.ground) this.groundMeshes.push(o); });
      this.fxRoot = new THREE.Group(); this.scene.add(this.fxRoot);
      this.cam = { x: 0, y: 3400, dist: 3000 };
      this.vis = new Map(); this.missiles = new Map(); this.fx = new Map(); this.transient = [];
      this.showLabels = true; this.showBars = true;
      this.ringGeo = new THREE.RingGeometry(0.86, 1, 40);
      this.placement = null; this.rangeRings = [];
      this.portrait = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 5, 5000), inst: null, key: '' };
      this.portrait.scene.add(new THREE.AmbientLight(0xffffff, 0.75)); const pl = new THREE.DirectionalLight(0xffffff, 0.7); pl.position.set(300, -200, 400); this.portrait.scene.add(pl);
      this.portrait.camera.up.set(0, 0, 1);
      this.raycaster = new THREE.Raycaster();
      this.dnc = MDX.load('Environment\\DNC\\DNCLordaeron\\DNCLordaeronTerrain\\DNCLordaeronTerrain.mdl');
      // the map's own decoration trigger: fire at region Gebiet_067 every 0.65 s
      this.mapFireAt = 0;
    }
    attach(world, rules, me) {
      for (const v of this.vis.values()) this.dropVis(v);
      this.vis.clear();
      for (const m of this.missiles.values()) this.dropMissile(m); this.missiles.clear();
      for (const f of this.fx.values()) this.dropFx(f); this.fx.clear();
      for (const t of this.transient) t.inst.dispose(); this.transient = [];
      this.world = world; this.rules = rules; this.me = me;
      world.on('attackStart', (a) => { const v = this.vis.get(a.id); if (v) v.attackAt = performance.now(); });
      world.on('hit', (a, t, dmg) => { // melee impact sounds (missiles use their model's sound events)
        if (!a || !t || a.def.weapon !== 'normal' || dmg <= 0) return;
        const S = window.PYRO_SOUNDS; if (!S || !snd()) return;
        const wt = S.combat[a.typeId]; if (!wt) return; const arm = S.armor[t.typeId] || 'Flesh';
        snd().playAt(S.sounds[wt + arm] ? wt + arm : wt + 'Flesh', t.x, t.y);
      });
      world.on('death', (u) => {
        const v = this.vis.get(u.id); if (!v) return;
        if (u.structure && u.def.specialArt) this.spawnModel(u.def.specialArt, u.x, u.y, TR.heightAt(u.x, u.y));
      });
    }
    teamColor(u) {
      if (u.structure || u.flags.colorTeam == null && u.flags.middle == null) return WC3_COLORS[u.owner];
      const t = u.flags.colorTeam != null ? u.flags.colorTeam : u.flags.middle;
      return t === 0 ? WC3_COLORS[0] : WC3_COLORS[1];
    }
    soundEvent(name, pos) { // MDX event object "SNDx####" -> AnimSounds.slk
      const S = window.PYRO_SOUNDS; if (!S || !snd() || !/^SND/.test(name)) return;
      const label = S.anim[name.slice(4, 8).toUpperCase()]; if (label) snd().playAt(label, pos.x, pos.y);
    }
    // ---------------------------------------------------------------- unit visuals
    makeVis(u) {
      const root = new THREE.Group(); const r = resolve(u.def);
      const v = { u, root, r, inst: null, state: '', attackAt: 0, typeId: u.typeId, buffs: new Map() };
      if (r.md) {
        v.inst = new MDX.Instance(r.md, { team: this.teamColor(u), fxRoot: this.fxRoot, props: r.props, onEvent: (n, p) => this.soundEvent(n, p) });
        v.inst.group.scale.setScalar(r.scale);
        if (u.def.tint && (u.def.tint[0] < 255 || u.def.tint[1] < 255 || u.def.tint[2] < 255)) for (const m of v.inst.meshes) if (!m.material.userData.teamLayer) { m.material.color.multiply(new THREE.Color(u.def.tint[0] / 255, u.def.tint[1] / 255, u.def.tint[2] / 255)); m.userData.baseColor.copy(m.material.color); }
        root.add(v.inst.group);
      }
      // ground decals: building splat, unit shadow, selection circle
      if (u.structure) {
        const us = (GF.uberSplats || {})[u.def.uberSplat];
        if (us && A.hasTexture(us.tex)) { const d = new THREE.Mesh(planeGeo, decalMaterial(us.tex, 0xffffff, 1)); d.scale.setScalar(us.scale * 2); d.position.z = 2; d.renderOrder = -20; root.add(d); v.splat = d; }
      } else if (u.typeId !== 'o000') {
        const fly = u.def.moveType === 'fly';
        const tex = fly ? 'ReplaceableTextures\\Shadows\\ShadowFlyer.blp' : 'ReplaceableTextures\\Shadows\\Shadow.blp';
        const sh = new THREE.Mesh(planeGeo, A.hasTexture(tex) ? decalMaterial(tex, 0xffffff, 0.75) : decalMaterial(null, 0x000000, 0.35));
        const s = Math.max(60, u.collision * 4.2) * (u.def.scale || 1); sh.scale.set(s, s, 1); sh.renderOrder = -15; root.add(sh); v.shadow = sh;
      }
      const selTex = 'ReplaceableTextures\\Selection\\SelectionCircleMed.blp';
      const ring = A.hasTexture(selTex) ? new THREE.Mesh(planeGeo, decalMaterial(selTex, 0x00ff00, 1, true)) : new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, depthWrite: false }));
      const rs = u.structure ? Math.max(70, (u.def.selScale || 2) * 40) : Math.max(28, (u.def.selScale || 1) * 36);
      ring.scale.set(rs * 2, rs * 2, 1); ring.renderOrder = -5; ring.visible = false; root.add(ring); v.ring = ring;
      v.color = this.teamColor(u);
      this.scene.add(root); this.vis.set(u.id, v); return v;
    }
    dropVis(v) { if (v.inst) v.inst.dispose(); for (const b of v.buffs.values()) b.dispose(); if (v.fire) v.fire.dispose(); this.scene.remove(v.root); }
    syncUnits(dt, alpha) {
      const w = this.world; const seen = new Set();
      for (const u of w.units) {
        if (u.removed) continue;
        let v = this.vis.get(u.id);
        if (v && v.typeId !== u.typeId) { this.dropVis(v); this.vis.delete(u.id); v = null; }
        if (!v) v = this.makeVis(u);
        seen.add(u.id);
        let x = u.x, y = u.y;
        if (u.px != null && Math.hypot(u.x - u.px, u.y - u.py) < 200) { x = u.px + (u.x - u.px) * alpha; y = u.py + (u.y - u.py) * alpha; }
        const gz = TR.heightAt(x, y); const fly = u.def.moveType === 'fly' ? u.def.flyHeight || 0 : 0;
        v.root.position.set(x, y, gz);
        if (v.inst) v.inst.group.position.z = fly;
        if (v.shadow) { v.shadow.position.z = 3; v.shadow.visible = !u.dead; }
        const targetRot = (u.facing != null ? u.facing : 270) * Math.PI / 180;
        if (v.inst) {
          let d = targetRot - v.inst.group.rotation.z; d = Math.atan2(Math.sin(d), Math.cos(d));
          v.inst.group.rotation.z += u.structure ? d : d * Math.min(1, dt * 0.012);
        }
        const col = this.teamColor(u); if (col !== v.color && v.inst) { v.inst.setTeamColor(col); v.color = col; }
        this.animate(v, u, dt);
        this.syncBuffs(v, u, dt);
        v.ring.visible = !u.dead && (this.selected === u.id || this.hovered === u.id);
        if (v.ring.visible) {
          v.ring.position.z = 4;
          v.ring.material.color.set(u.owner === this.me ? 0x00ff00 : this.world.ally(u.owner, this.me) ? 0xffff00 : 0xff2020);
          v.ring.material.opacity = this.selected === u.id ? 1 : 0.45;
        }
      }
      for (const [id, v] of this.vis) if (!seen.has(id)) { this.dropVis(v); this.vis.delete(id); }
    }
    attachPos(v, name, out) { // world position of a model attachment point
      const inst = v.inst; out.set(0, 0, 0);
      const p = inst ? inst.attachment(name) : null;
      if (p) { out.copy(p).applyMatrix4(inst.group.matrixWorld); return out; }
      out.copy(v.root.position); out.z += name === 'overhead' ? 150 * (v.u.def.scale || 1) : name === 'chest' || name.startsWith('hand') ? 60 : 0;
      return out;
    }
    syncBuffs(v, u, dt) {
      const want = new Set();
      if (!u.dead) {
        for (const b of u.buffs) { if (BUFF_FX[b.id]) want.add(b.id); if (b.id === 'lust') want.add('lust2'); if (b.stun) want.add('stun'); }
        if (u.invulnerable && !u.structure && u.flags.maze != null) want.add('invuln');
        if (u.aura && u.aura.srcs && u.aura.srcs.length && !u.structure) want.add('aura');
      }
      for (const [k, inst] of v.buffs) if (!want.has(k)) { inst.dispose(); v.buffs.delete(k); }
      const tmp = this._tmpV || (this._tmpV = new THREE.Vector3());
      for (const k of want) {
        let inst = v.buffs.get(k);
        if (!inst) {
          const md = MDX.load(BUFF_FX[k][0]); if (!md) continue;
          inst = new MDX.Instance(md, { fxRoot: this.fxRoot, onEvent: (n, p) => this.soundEvent(n, p) }); inst.play('birth', { loop: false }) || inst.play('stand', { loop: true });
          this.scene.add(inst.group); v.buffs.set(k, inst);
        }
        if (inst.done && inst.tag === 'birth') inst.play('stand', { loop: true });
        this.attachPos(v, BUFF_FX[k][1], tmp); inst.group.position.copy(tmp); inst.group.scale.setScalar(Math.max(0.6, u.def.scale || 1));
        inst.group.updateMatrixWorld(); inst.update(dt, this.camera);
      }
      // burning buildings (WC3: fire when a building is below 50% / 25% life)
      if (u.structure && !u.dead && !u.building && u.typeId !== 'o000') {
        const f = u.hp / u.maxHp(); const big = (u.footprintSize || 4) > 4;
        const lvl = f < 0.25 ? 2 : f < 0.5 ? 1 : 0;
        if (lvl !== v.fireLvl) {
          if (v.fire) { v.fire.dispose(); v.fire = null; }
          if (lvl) { const list = FIRE_FX[big || lvl === 2 ? 'large' : 'small']; const md = MDX.load(list[u.id % list.length]); if (md) { v.fire = new MDX.Instance(md, { fxRoot: this.fxRoot }); v.fire.play('stand', { loop: true }); this.scene.add(v.fire.group); } }
          v.fireLvl = lvl;
        }
        if (v.fire) { v.fire.group.position.set(v.root.position.x, v.root.position.y, v.root.position.z + 40); v.fire.group.updateMatrixWorld(); v.fire.update(dt, this.camera); }
      } else if (v.fire) { v.fire.dispose(); v.fire = null; v.fireLvl = 0; }
    }
    animate(v, u, dt) {
      const inst = v.inst; if (!inst) return;
      const now = performance.now(); let want, opts = {};
      if (u.dead) {
        const age = this.world.time - (u.deathTime || this.world.time);
        if (v.state !== 'death' && v.state !== 'decay') { inst.play('death', { loop: false }) || inst.setOpacity(0.5); v.state = 'death'; }
        else if (v.state === 'death' && inst.done) { if (inst.play('decay flesh', { loop: false })) v.state = 'decay'; else v.state = 'decay'; }
        inst.setOpacity(Math.max(0, 1 - Math.max(0, age - 2.5) / 1.5));
        inst.group.updateMatrixWorld(); inst.update(dt, this.camera); return;
      } else if (u.flags.reincarnating) { want = 'death'; opts.loop = false; }
      else if (u.building && u.building.kind === 'construct') {
        want = 'birth';
        if (v.state !== want) { inst.play('birth', { loop: false }) || inst.play('stand'); v.state = want; }
        const s = inst.md.sequences[inst.seq];
        if (s && inst.tag === 'birth') { const total = u.def.build || 1; const f = 1 - Math.max(0, u.building.until - this.world.time) / total; inst.frame = s.interval[0] + (s.interval[1] - s.interval[0]) * f; inst.speed = 0; }
        inst.group.updateMatrixWorld(); inst.update(0, this.camera); return;
      } else if (u.building && u.building.kind === 'upgrade') want = 'stand work';
      else if (v.attackAt && now - v.attackAt < 1000 * Math.max(0.35, Math.min(1.2, u.cooldown()))) {
        want = 'attack';
        if (v.state !== 'attack' || v.attackPlayed !== v.attackAt) {
          v.attackPlayed = v.attackAt; inst.play('attack', { loop: false, restart: true }) || inst.play('stand', { restart: true });
          const d = inst.duration(); inst.speed = d > u.cooldown() ? d / u.cooldown() : 1; v.state = 'attack';
        }
      } else if (u.moving && !u.structure) {
        want = 'walk';
        if (v.state !== 'walk') inst.play('walk', { loop: true });
        const ws = u.def.walkSpeed || inst.seqMoveSpeed() || 270; inst.speed = Math.max(0.2, Math.min(3, u.moveSpeed() / ws));
      } else want = 'stand';
      if (want !== 'attack' && want !== v.state) {
        const ok = inst.play(want, opts) || (want === 'stand work' && inst.play('stand'));
        if (want !== 'walk') inst.speed = 1;
        if (!ok && want === 'death') inst.setOpacity(0.4);
        v.state = want;
      }
      if (v.state === 'stand' && inst.done) inst.play('stand', { restart: true, loop: false }); // pick another stand variation
      inst.group.updateMatrixWorld();
      inst.update(dt, this.camera);
    }
    // ---------------------------------------------------------------- missiles
    dropMissile(m) { if (m.inst) m.inst.dispose(); if (m.mesh) this.scene.remove(m.mesh); }
    syncMissiles(alpha, dt) {
      const live = new Set();
      for (const p of this.world.projectiles) {
        if (p.done) continue; live.add(p);
        let m = this.missiles.get(p);
        if (!m) {
          const src = D.units[p.src] || {}; m = { sx: p.x, sy: p.y, arc: src.missileArc || 0, z0: (src.launchZ || 60) + (src.moveType === 'fly' ? src.flyHeight || 0 : 0) };
          const md = src.missileArt ? MDX.load(src.missileArt.split(',')[0]) : null;
          if (md) { m.inst = new MDX.Instance(md, { fxRoot: this.fxRoot, onEvent: (n, q) => this.soundEvent(n, q) }); m.inst.play('stand', { loop: true }); this.scene.add(m.inst.group); }
          else if (p.speed < 5000) {
            const col = { magic: 0xc77dff, chaos: 0xff9f1c, pierce: 0xffffff, siege: 0xc8a26a, normal: 0xffe066, spells: 0x9bf6ff, fire: 0xff5d2a }[p.kind] || 0xffffff;
            m.mesh = new THREE.Mesh(new THREE.SphereGeometry(8, 8, 6), new THREE.MeshBasicMaterial({ color: col })); this.scene.add(m.mesh);
          }
          this.missiles.set(p, m);
        }
        const tx = p.target ? p.target.x : p.tx, ty = p.target ? p.target.y : p.ty;
        const total = Math.hypot(tx - m.sx, ty - m.sy) || 1; const left = Math.hypot(tx - p.x, ty - p.y);
        const f = Math.max(0, Math.min(1, 1 - left / total));
        const tz = p.target ? TR.heightAt(tx, ty) + ((p.target.def && p.target.def.impactZ) || 60) + (p.target.def && p.target.def.moveType === 'fly' ? p.target.def.flyHeight || 0 : 0) : TR.heightAt(tx, ty);
        const z0 = TR.heightAt(m.sx, m.sy) + m.z0;
        const z = z0 + (tz - z0) * f + 4 * m.arc * total * 0.5 * f * (1 - f);
        m.last = { x: p.x, y: p.y, z };
        const obj = m.inst ? m.inst.group : m.mesh;
        if (obj) {
          const prev = obj.position.clone(); obj.position.set(p.x, p.y, z);
          const d = obj.position.clone().sub(prev);
          if (d.lengthSq() > 0.01) { obj.rotation.set(0, -Math.atan2(d.z, Math.hypot(d.x, d.y)), Math.atan2(d.y, d.x), 'ZYX'); }
          obj.updateMatrixWorld();
        }
        if (m.inst) m.inst.update(dt, this.camera);
      }
      for (const [p, m] of this.missiles) if (!live.has(p)) {
        this.missiles.delete(p);
        if (m.inst && m.last) { // impact: the missile model's death animation (and its sound events)
          if (m.inst.play('death', { loop: false })) { m.inst.stopEmitting(); this.transient.push({ inst: m.inst, until: performance.now() + 3000, follow: null }); continue; }
        }
        this.dropMissile(m);
      }
    }
    // ---------------------------------------------------------------- spell / trigger effects
    spawnModel(path, x, y, z, opts = {}) {
      const md = MDX.load(path); if (!md) return null;
      const inst = new MDX.Instance(md, { fxRoot: this.fxRoot, team: opts.team, onEvent: (n, p) => this.soundEvent(n, p) });
      const order = ['birth', 'stand', 'death'].filter(t => md.sequence(t) >= 0);
      inst.fxOrder = order.length ? order : ['stand']; inst.fxStep = 0; inst.play(inst.fxOrder[0], { loop: false });
      inst.group.position.set(x, y, z); if (opts.scale) inst.group.scale.setScalar(opts.scale); if (opts.angle) inst.group.rotation.z = opts.angle;
      inst.group.updateMatrixWorld(); this.scene.add(inst.group);
      this.transient.push({ inst, until: performance.now() + (opts.max || 5000) });
      return inst;
    }
    updateTransient(dt) {
      const now = performance.now();
      this.transient = this.transient.filter(t => {
        const inst = t.inst;
        if (inst.done && inst.fxOrder && inst.fxStep < inst.fxOrder.length - 1) { inst.fxStep++; inst.play(inst.fxOrder[inst.fxStep], { loop: false }); }
        else if (inst.done) inst.stopEmitting();
        inst.group.updateMatrixWorld(); inst.update(dt, this.camera);
        const finished = (inst.done && (!inst.fxOrder || inst.fxStep >= inst.fxOrder.length - 1) && !inst.busy) || now > t.until;
        if (finished) { inst.dispose(); return false; }
        return true;
      });
    }
    lightning(e) { // chain lightning: textured, flickering bolt between two points
      const L = (GF.lightning || {}).CLPB; const tex = L ? A.texture(L.tex.endsWith('.blp') ? L.tex : L.tex + '.blp', 0) : null;
      const z1 = TR.heightAt(e.x, e.y) + 80, z2 = TR.heightAt(e.x2, e.y2) + 60;
      const a = new THREE.Vector3(e.x, e.y, z1), b = new THREE.Vector3(e.x2, e.y2, z2);
      const n = Math.max(2, Math.round(a.distanceTo(b) / (L ? L.seg : 100))); const width = L ? L.width : 50;
      const pos = new Float32Array((n + 1) * 2 * 3), uv = new Float32Array((n + 1) * 2 * 2), idx = [];
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      for (let i = 0; i < n; i++) { const o = i * 2; idx.push(o, o + 1, o + 3, o, o + 3, o + 2); }
      g.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x9bf6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 210;
      mesh.userData = { a, b, n, width, update: () => {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const dir = b.clone().sub(a); const side = dir.clone().cross(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)).normalize().multiplyScalar(width / 2);
        for (let i = 0; i <= n; i++) {
          const f = i / n; const p = a.clone().lerp(b, f);
          if (i > 0 && i < n) p.addScaledVector(right, (Math.random() - 0.5) * 40).addScaledVector(up, (Math.random() - 0.5) * 40);
          pos.set([p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z], i * 6);
          uv.set([f * n * (L ? L.uv : 0.5), 0, f * n * (L ? L.uv : 0.5), 1], i * 4);
        }
        g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true;
      } };
      return mesh;
    }
    dropFx(f) { if (f.mesh) { this.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); } }
    syncEffects() {
      const w = this.world; const live = new Set();
      for (const e of w.effects) {
        const t = (w.time - e.at) / e.dur; if (t < 0 || t > 1 || e.text) continue; live.add(e);
        let f = this.fx.get(e);
        if (!f) {
          f = {}; this.fx.set(e, f);
          const gz = TR.heightAt(e.x, e.y);
          if (e.kind === 'bolt' && !e.color) { f.mesh = this.lightning(e); this.scene.add(f.mesh); snd() && snd().playAt('ChainLightning', e.x2, e.y2); }
          else if (e.kind === 'bolt') { this.spawnModel(FX.quake, e.x2, e.y2, TR.heightAt(e.x2, e.y2)); }
          else if (e.kind === 'lasthope') { for (const [dx, dy] of LASTHOPE_OFFSETS) this.spawnModel(FX.lasthope, e.x + dx, e.y + dy, TR.heightAt(e.x + dx, e.y + dy)); }
          else if (e.model || FX[e.kind]) {
            const big = e.kind === 'blizzard' || e.kind === 'meteor' ? Math.max(0.8, (e.r || 200) / 200) : 1;
            this.spawnModel(e.model || FX[e.kind], e.x, e.y, gz, { scale: big });
          } else if (e.kind === 'splash') { /* the missile's own death animation covers it */ }
          else {
            f.mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
            f.mesh.position.set(e.x, e.y, gz + 8); this.scene.add(f.mesh);
          }
        }
        if (f.mesh) {
          f.mesh.material.opacity = 1 - t;
          if (f.mesh.userData.update) f.mesh.userData.update(); else f.mesh.scale.setScalar(Math.max(10, (e.r || 90) * (0.35 + 0.65 * t)));
        }
      }
      for (const [e, f] of this.fx) if (!live.has(e)) { this.dropFx(f); this.fx.delete(e); }
      // map decoration: "special effect bug" trigger keeps a fire burning at Gebiet_067
      const r = this.rules && this.rules.R('Gebiet_067');
      if (r && w.time >= this.mapFireAt) { this.mapFireAt = w.time + 0.65; const x = (r[0] + r[2]) / 2, y = (r[1] + r[3]) / 2; this.spawnModel('Abilities\\Spells\\Other\\BreathOfFire\\BreathOfFireDamage.mdl', x, y, TR.heightAt(x, y), { max: 3000 }); }
    }
    // ---------------------------------------------------------------- placement ghost + magnetic grid
    // p: null | {typeId, x, y (snapped centre), cells:[{x,y,ok}], range, ok}
    setPlacement(p) {
      const P = this.placement || (this.placement = { group: new THREE.Group(), grid: new THREE.Group(), cellsG: new THREE.Group(), key: '', type: '', ghost: null, gx: 0, gy: 0, tx: 0, ty: 0 });
      if (!P.group.parent) { this.scene.add(P.group); P.group.add(P.grid, P.cellsG); }
      if (!p) { P.group.visible = false; P.type = ''; return; }
      P.group.visible = true;
      if (p.typeId !== P.type) {
        if (P.ghost) { P.group.remove(P.ghost.group); P.ghost.dispose(); P.ghost = null; }
        if (P.rangeLine) { P.group.remove(P.rangeLine); P.rangeLine = null; }
        P.type = p.typeId; P.key = '';
        const r = resolve(D.units[p.typeId]);
        if (r.md) {
          const inst = new MDX.Instance(r.md, { team: WC3_COLORS[this.me], props: r.props }); inst.group.scale.setScalar(r.scale); inst.setOpacity(0.6);
          inst.group.rotation.z = 270 * Math.PI / 180; inst.play('stand'); P.group.add(inst.group); P.ghost = inst;
        }
        P.gx = p.x; P.gy = p.y;
      }
      P.tx = p.x; P.ty = p.y; P.range = p.range;
      const key = p.x + '|' + p.y + '|' + p.cells.map(c => c.ok ? 1 : 0).join('') + '|' + p.ok;
      if (key === P.key) return; P.key = key;
      P.grid.clear();
      const fine = [], tile = []; const R = 14 * 32; const x0 = p.x - R, x1 = p.x + R, y0 = p.y - R, y1 = p.y + R;
      const seg = (arr, ax, ay, bx, by) => { const n = 8; for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n;
        const xa = ax + (bx - ax) * t0, ya = ay + (by - ay) * t0, xb = ax + (bx - ax) * t1, yb = ay + (by - ay) * t1;
        arr.push(xa, ya, TR.heightAt(xa, ya) + 3, xb, yb, TR.heightAt(xb, yb) + 3); } };
      for (let x = Math.ceil(x0 / 32) * 32; x <= x1; x += 32) seg(x % 128 === 0 ? tile : fine, x, y0, x, y1);
      for (let y = Math.ceil(y0 / 32) * 32; y <= y1; y += 32) seg(y % 128 === 0 ? tile : fine, x0, y, x1, y);
      const mk = (arr, op) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, depthWrite: false })); l.renderOrder = 5; return l; };
      P.grid.add(mk(fine, 0.10), mk(tile, 0.32));
      P.cellsG.clear();
      for (const c of p.cells) {
        const q = new THREE.Mesh(this.cellGeo || (this.cellGeo = new THREE.PlaneGeometry(29, 29)), new THREE.MeshBasicMaterial({ color: c.ok && p.ok ? 0x00ff40 : c.ok ? 0xffd000 : 0xff2020, transparent: true, opacity: 0.5, depthWrite: false }));
        q.position.set(c.x + 16, c.y + 16, TR.heightAt(c.x + 16, c.y + 16) + 4); q.renderOrder = 6; P.cellsG.add(q);
      }
    }
    updatePlacement(dt) {
      const P = this.placement; if (!P || !P.group.visible) return;
      const k = 1 - Math.exp(-dt / 45);
      P.gx += (P.tx - P.gx) * k; P.gy += (P.ty - P.gy) * k;
      if (Math.abs(P.tx - P.gx) < 0.5) P.gx = P.tx; if (Math.abs(P.ty - P.gy) < 0.5) P.gy = P.ty;
      if (P.ghost) { P.ghost.group.position.set(P.gx, P.gy, TR.heightAt(P.tx, P.ty)); P.ghost.group.updateMatrixWorld(); P.ghost.update(dt, this.camera); }
      const rk = P.tx + ',' + P.ty + ',' + P.range;
      if (P.rangeKey !== rk) { if (P.rangeLine) P.group.remove(P.rangeLine); P.rangeLine = P.range ? this.circle(P.tx, P.ty, P.range, 0xffffff, 0.45) : null; if (P.rangeLine) P.group.add(P.rangeLine); P.rangeKey = rk; }
    }
    circle(x, y, r, color, opacity) {
      const pts = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; pts.push(new THREE.Vector3(px, py, TR.heightAt(px, py) + 6)); }
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    }
    showRange(x, y, r, seconds) { const c = this.circle(x, y, r, 0x7cfc00, 0.9); this.scene.add(c); this.rangeRings.push({ c, until: performance.now() + seconds * 1000 }); }
    // ---------------------------------------------------------------- camera & light
    updateCamera() {
      const b = D.geo.bounds.camera;
      this.cam.x = Math.max(b[0], Math.min(b[2], this.cam.x)); this.cam.y = Math.max(b[1], Math.min(b[3], this.cam.y));
      const tz = TR.heightAt(this.cam.x, this.cam.y);
      const d = this.cam.dist;
      this.camera.position.set(this.cam.x, this.cam.y - d * Math.cos(AOA), tz + d * Math.sin(AOA));
      this.camera.lookAt(this.cam.x, this.cam.y, tz);
      if (snd()) snd().listener(this.cam.x, this.cam.y, d);
    }
    resize(w, fullH, worldH) {
      this.renderer.setSize(w, fullH, false); this.overlay.width = w; this.overlay.height = worldH;
      this.camera.aspect = w / worldH; this.camera.updateProjectionMatrix(); this.W = w; this.H = worldH; this.FH = fullH;
    }
    lighting() {
      const w = this.world; if (!w) return;
      const hour = w.timeOfDay();
      const md = this.dnc;
      if (md && MDX.lightAt && md.sequences.length) { // Warcraft's day/night model (DNCLordaeronTerrain): one sequence = 24 hours
        const s = md.sequences[0]; const frame = s.interval[0] + (s.interval[1] - s.interval[0]) * (hour / 24);
        const L = MDX.lightAt(md, frame);
        if (L) {
          // colours from the model; Warcraft clamps the result, so scale down to stay below 1 on lit ground
          this.sun.color.setRGB(Math.min(1.2, L.color[0]) * 0.6, Math.min(1.2, L.color[1]) * 0.6, Math.min(1.2, L.color[2]) * 0.6); this.sun.intensity = 1.0;
          this.sun.position.set(-1600, -1800, 3000);
          this.ambient.color.setRGB(0.25 + L.ambient[0] * 1.6, 0.25 + L.ambient[1] * 1.6, 0.25 + L.ambient[2] * 1.6); this.ambient.intensity = 1.0;
          return;
        }
      }
      const night = w.isNight(); const dawn = (hour > 5 && hour < 7) || (hour > 17 && hour < 19);
      this.sun.color.set(night ? 0x7080c0 : dawn ? 0xffc890 : 0xfff6e6); this.sun.intensity = night ? 0.45 : 0.8;
      this.ambient.color.set(night ? 0x5060a0 : 0xffffff); this.ambient.intensity = night ? 0.45 : 0.55;
    }
    // ---------------------------------------------------------------- frame
    frame(dt, alpha) {
      if (!this.world) return;
      this.updateCamera(); this.lighting();
      this.syncUnits(dt, alpha); this.syncMissiles(alpha, dt); this.syncEffects(); this.updateTransient(dt);
      if (TR.updateDoodads) TR.updateDoodads(dt, this.camera);
      const now = performance.now();
      this.rangeRings = this.rangeRings.filter(r => { if (now > r.until) { this.scene.remove(r.c); return false; } return true; });
      this.updatePlacement(dt);
      const r = this.renderer; r.setScissorTest(false); r.setViewport(0, 0, this.W, this.FH); r.clear();
      r.setViewport(0, this.FH - this.H, this.W, this.H);
      r.render(this.scene, this.camera);
      this.drawOverlay();
    }
    renderPortrait(rect, unit, dt) {
      const P = this.portrait; const r = this.renderer;
      const key = unit ? unit.typeId + ':' + this.teamColor(unit) : '';
      if (key !== P.key) {
        if (P.inst) { P.inst.dispose(); P.inst = null; }
        P.key = key;
        if (unit) {
          const pm = portraitModel(unit.def);
          if (pm.md) {
            P.inst = new MDX.Instance(pm.md, { team: this.teamColor(unit), props: pm.props });
            P.inst.play(pm.portrait ? 'portrait' : 'stand') || P.inst.play('stand');
            P.scene.add(P.inst.group); P.portraitModel = pm;
            const cams = pm.md.m.cameras || [];
            if (cams.length) {
              const c = cams[0]; P.camera.fov = Math.max(20, Math.min(70, c.fieldOfView * 180 / Math.PI * 0.75));
              P.camera.position.set(c.position[0], c.position[1], c.position[2]); P.camera.lookAt(c.targetPosition[0], c.targetPosition[1], c.targetPosition[2]);
            } else {
              const e = pm.md.body; const h = e.max[2] - e.min[2]; const cx = (e.max[0] + e.min[0]) / 2, cy = (e.max[1] + e.min[1]) / 2;
              const wd = Math.max(e.max[0] - e.min[0], e.max[1] - e.min[1]);
              const focusZ = unit.structure ? e.min[2] + h * 0.45 : e.min[2] + h * 0.78;
              const dist = unit.structure ? Math.max(h, wd) * 3.6 : h * 0.9;
              P.camera.fov = 30; P.camera.position.set(cx + dist * 0.95, cy - dist * 0.3, focusZ + dist * (unit.structure ? 0.35 : 0.12)); P.camera.lookAt(cx, cy, focusZ);
            }
          }
        }
      }
      if (!P.inst || !rect) return;
      P.inst.group.updateMatrixWorld(); P.inst.update(dt, P.camera);
      if (P.inst.done) P.inst.play(P.portraitModel && P.portraitModel.portrait ? 'portrait' : 'stand', { restart: true });
      const x = rect.x, y = this.FH - rect.y - rect.h;
      r.setScissorTest(true); r.setScissor(x, y, rect.w, rect.h); r.setViewport(x, y, rect.w, rect.h);
      P.camera.aspect = rect.w / rect.h; P.camera.updateProjectionMatrix();
      r.setClearColor(0x05070a, 1); r.clear(); r.render(P.scene, P.camera);
      r.setScissorTest(false); r.setClearColor(0x000000, 1);
    }
    // ---------------------------------------------------------------- overlay (health bars, labels, floating text)
    project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(this.camera); return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H, on: v.z < 1 && v.z > -1 }; }
    drawOverlay() {
      const g = this.octx; g.clearRect(0, 0, this.W, this.H); const w = this.world;
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      const scale = Math.max(0.8, Math.min(1.35, 3000 / this.cam.dist));
      const font = this.font || 'Georgia, serif';
      const tmp = this._ovV || (this._ovV = new THREE.Vector3());
      for (const v of this.vis.values()) {
        const u = v.u; if (u.dead || u.removed) continue;
        let top;
        if (v.inst) { const oh = v.inst.attachment('overhead'); if (oh) { tmp.copy(oh).applyMatrix4(v.inst.group.matrixWorld); top = tmp.z - v.root.position.z + 20; } }
        if (top == null) top = (u.structure ? 150 : 120) * (u.def.scale || 1);
        const p = this.project(v.root.position.x, v.root.position.y, v.root.position.z + top);
        if (!p.on || p.x < -50 || p.x > this.W + 50 || p.y < -50 || p.y > this.H) continue;
        const showBar = this.showBars && u.typeId !== 'o000' && (!u.structure || this.selected === u.id || this.hovered === u.id || this.rules.T.castles.includes(u.typeId) || this.rules.T.guardTowers.includes(u.typeId) || u.building || this.altDown);
        if (showBar) {
          const bw = Math.max(26, (u.structure ? 64 : 36) * scale), bh = Math.max(4, 5 * scale);
          const f = Math.max(0, Math.min(1, u.hp / u.maxHp()));
          g.fillStyle = '#000'; g.fillRect(p.x - bw / 2 - 1, p.y - bh - 1, bw + 2, bh + 2);
          g.fillStyle = `rgb(${Math.round(255 * Math.min(1, 2 - 2 * f))},${Math.round(255 * Math.min(1, 2 * f))},0)`; g.fillRect(p.x - bw / 2, p.y - bh, bw * f, bh);
          if (u.building) { const total = u.building.kind === 'construct' ? u.def.build : D.units[u.building.to].build; const pf = 1 - Math.max(0, u.building.until - w.time) / total;
            g.fillStyle = '#000'; g.fillRect(p.x - bw / 2 - 1, p.y + 2, bw + 2, bh + 2); g.fillStyle = '#4aa3ff'; g.fillRect(p.x - bw / 2, p.y + 3, bw * pf, bh); }
        }
        if (this.showLabels && v.r.standin && (this.hovered === u.id || this.selected === u.id || this.labelsAll)) {
          g.font = `${Math.round(Math.max(10, 11 * scale))}px ${font}`;
          const txt = u.def.name + '  (stand-in)';
          const tw = g.measureText(txt).width;
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(p.x - tw / 2 - 4, p.y - 26 * Math.max(1, scale) - 14, tw + 8, 16);
          g.fillStyle = '#ffcc00'; g.fillText(txt, p.x, p.y - 26 * Math.max(1, scale));
        }
      }
      for (const e of w.effects) { // floating text (gold, crits, buffs) like Warcraft's text tags
        if (!e.text) continue; const t = (w.time - e.at) / e.dur; if (t < 0 || t > 1) continue;
        if (e.kind === 'buff' && this.cam.dist > 3200) continue;
        const p = this.project(e.x, e.y, TR.heightAt(e.x, e.y) + 140 + t * 80); if (!p.on) continue;
        g.globalAlpha = Math.min(1, 2 - 2 * t); g.font = `bold ${Math.round(13 * scale)}px ${font}`;
        g.fillStyle = e.color || (e.kind === 'gold' ? '#ffcc00' : e.kind === 'crit' ? '#ff3030' : e.kind === 'heal' ? '#40ff40' : '#ffffff');
        g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 3; g.strokeText(e.text, p.x, p.y); g.fillText(e.text, p.x, p.y);
        g.globalAlpha = 1;
      }
    }
    // ---------------------------------------------------------------- helpers for the console
    viewQuad() {
      const tz = TR.heightAt(this.cam.x, this.cam.y); const out = [];
      for (const [sx, sy] of [[0, 0], [this.W, 0], [this.W, this.H], [0, this.H]]) {
        this.raycaster.setFromCamera(new THREE.Vector2(sx / this.W * 2 - 1, -(sy / this.H) * 2 + 1), this.camera);
        const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
        let t = d.z < -1e-4 ? (tz - o.z) / d.z : 20000; t = Math.min(t, 20000);
        out.push({ x: o.x + d.x * t, y: o.y + d.y * t });
      }
      return out;
    }
    setQueueMarks(list) {
      const key = list.map(j => j.unit + j.x + ',' + j.y).join('|'); if (key === this.qKey) return; this.qKey = key;
      if (!this.qGroup) { this.qGroup = new THREE.Group(); this.scene.add(this.qGroup); }
      this.qGroup.clear();
      for (const j of list) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(124, 124), new THREE.MeshBasicMaterial({ color: 0x40c0ff, transparent: true, opacity: 0.28, depthWrite: false }));
        q.position.set(j.x, j.y, TR.heightAt(j.x, j.y) + 5); this.qGroup.add(q);
      }
    }
    ping(x, y, color) { // Warcraft's order confirmation marker
      const md = MDX.load('UI\\Feedback\\Confirmation\\Confirmation.mdl');
      if (md && !color) { this.spawnModel('UI\\Feedback\\Confirmation\\Confirmation.mdl', x, y, TR.heightAt(x, y), { max: 1200 }); return; }
      const c = this.circle(x, y, 26, color || 0x00ff00, 1); this.scene.add(c); this.rangeRings.push({ c, until: performance.now() + 450 });
    }
    rectLine(r, color, opacity) {
      const pts = []; const edge = (ax, ay, bx, by) => { for (let i = 0; i <= 16; i++) { const x = ax + (bx - ax) * i / 16, y = ay + (by - ay) * i / 16; pts.push(new THREE.Vector3(x, y, TR.heightAt(x, y) + 6)); } };
      edge(r[0], r[1], r[2], r[1]); edge(r[2], r[1], r[2], r[3]); edge(r[2], r[3], r[0], r[3]); edge(r[0], r[3], r[0], r[1]);
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    }
    setHighlightRects(rects) {
      const key = JSON.stringify(rects || []); if (key === this.hlKey) return; this.hlKey = key;
      if (!this.hlGroup) { this.hlGroup = new THREE.Group(); this.scene.add(this.hlGroup); }
      this.hlGroup.clear(); for (const r of rects || []) this.hlGroup.add(this.rectLine(r, 0xffd000, 0.9));
    }
    // ---------------------------------------------------------------- picking
    groundAt(sx, sy) {
      const ndc = new THREE.Vector2(sx / this.W * 2 - 1, -(sy / this.H) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObjects(this.groundMeshes, false)[0];
      if (hit) return { x: hit.point.x, y: hit.point.y };
      const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction; if (Math.abs(d.z) < 1e-6) return null;
      const t = -o.z / d.z; return { x: o.x + d.x * t, y: o.y + d.y * t };
    }
    pick(sx, sy) {
      let best = null, bd = Infinity;
      for (const v of this.vis.values()) {
        const u = v.u; if (u.dead || u.removed) continue;
        const h = u.structure ? 80 : 50 + (u.def.moveType === 'fly' ? u.def.flyHeight || 0 : 0);
        const c = this.project(v.root.position.x, v.root.position.y, v.root.position.z + h);
        const e = this.project(v.root.position.x + (u.structure ? 64 : Math.max(30, u.collision)), v.root.position.y, v.root.position.z + h);
        const rad = Math.max(14, Math.abs(e.x - c.x) * 1.15);
        const d = Math.hypot(c.x - sx, c.y - sy);
        if (d < rad && d < bd) { bd = d; best = u; }
      }
      return best;
    }
  }

  window.PyroView = { View, resolve, WC3_COLORS, FX };
})();
