/* Warcraft III MDX model renderer for three.js.
 * Parsing uses the MIT-licensed mdx-m3-viewer parser (lib/mdxparser.js). Everything else is here:
 * skeletal animation, sequences (with animation props such as "upgrade second"), team colour/glow,
 * layer blending, texture animations and flipbooks, geoset colour/alpha, billboards, particle emitters
 * (type 2), ribbon emitters, event objects (blood spawns/splats) and lights (used for day/night).
 * Coordinates stay in Warcraft units (z is up).
 */
(function () {
  'use strict';
  const A = window.PyroAssets;
  const models = new Map();
  const PLAYER_HEX = ['#ff0303', '#0042ff', '#1ce6b9', '#540081', '#fffc00', '#fe8a0e', '#20c000', '#e55bb0', '#959697', '#7ebff1', '#106246', '#4e2a04'];

  // ---------------------------------------------------------------- helpers
  function hashColor(str) {
    let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    const c = new THREE.Color(); c.setHSL(((h >>> 0) % 360) / 360, 0.25, 0.55); return c;
  }
  const _glow = {};
  function glowTexture() { // fallback team glow: soft dot
    if (_glow.t) return _glow.t;
    const N = 64; const d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2); const a = Math.max(0, 1 - r) ** 2 * 0.8;
      const o = (y * N + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(a * 255); d[o + 3] = Math.round(a * 255);
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    _glow.t = t; return t;
  }
  function teamIndex(hex) { const i = PLAYER_HEX.indexOf(String(hex).toLowerCase()); return i; }
  function teamTexture(id, hex) { // replaceable 1 = TeamColor\TeamColorNN.blp, 2 = TeamGlow\TeamGlowNN.blp
    const i = teamIndex(hex); if (i < 0) return null;
    const p = (id === 1 ? 'ReplaceableTextures\\TeamColor\\TeamColor' : 'ReplaceableTextures\\TeamGlow\\TeamGlow') + String(i).padStart(2, '0') + '.blp';
    return A.hasTexture(p) ? A.texture(p, 0) : null;
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- track sampling
  const DEFAULTS = { KGTR: [0, 0, 0], KGRT: [0, 0, 0, 1], KGSC: [1, 1, 1] };
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  function sample(anim, frame, seq, globalSeqs, globalTime, def, out) {
    let start, end, t;
    if (anim.globalSequenceId >= 0 && globalSeqs[anim.globalSequenceId] !== undefined) {
      const dur = globalSeqs[anim.globalSequenceId]; start = 0; end = dur; t = dur ? globalTime % dur : 0;
    } else {
      if (!seq) return def; start = seq.interval[0]; end = seq.interval[1]; t = frame;
    }
    const fr = anim.frames; let lo = -1, hi = -1;
    // keys are sorted: binary search the first key >= start
    let a0 = 0, b0 = fr.length;
    while (a0 < b0) { const m = (a0 + b0) >> 1; if (fr[m] < start) a0 = m + 1; else b0 = m; }
    if (a0 < fr.length && fr[a0] <= end) { lo = a0; hi = a0; while (hi + 1 < fr.length && fr[hi + 1] <= end) hi++; }
    if (lo < 0) return def;
    const vals = anim.values;
    if (t <= fr[lo] || lo === hi) return vals[lo];
    if (t >= fr[hi]) return vals[hi];
    let k = lo; while (k < hi && fr[k + 1] <= t) k++;
    const a = vals[k], b = vals[k + 1];
    const f = (t - fr[k]) / (fr[k + 1] - fr[k]);
    const type = anim.interpolationType;
    if (type === 0) return a;
    const n = a.length;
    if (n === 4 && anim.name === 'KGRT') { // quaternion
      _qa.set(a[0], a[1], a[2], a[3]); _qb.set(b[0], b[1], b[2], b[3]); _qa.slerp(_qb, f);
      out[0] = _qa.x; out[1] = _qa.y; out[2] = _qa.z; out[3] = _qa.w; return out;
    }
    if (type === 1 || !anim.inTans || !anim.inTans.length) { for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * f; return out; }
    const oT = anim.outTans[k], iT = anim.inTans[k + 1];
    if (type === 2) { // hermite
      const f2 = f * f, f3 = f2 * f;
      const h1 = 2 * f3 - 3 * f2 + 1, h2 = f3 - 2 * f2 + f, h3 = f3 - f2, h4 = -2 * f3 + 3 * f2;
      for (let i = 0; i < n; i++) out[i] = a[i] * h1 + oT[i] * h2 + iT[i] * h3 + b[i] * h4;
    } else { // bezier
      const inv = 1 - f, f1 = inv * inv * inv, f2 = 3 * f * inv * inv, f3 = 3 * f * f * inv, f4 = f * f * f;
      for (let i = 0; i < n; i++) out[i] = a[i] * f1 + oT[i] * f2 + iT[i] * f3 + b[i] * f4;
    }
    return out;
  }
  function track(obj, name) { return (obj && obj.animations || []).find(a => a.name === name) || null; }
  const _s1 = new Float32Array(1);
  function scalar(obj, name, def, inst, seq) {
    const tr = track(obj, name); if (!tr) return def;
    const v = sample(tr, inst.frame, seq, inst.md.globalSeqs, inst.globalTime, null, _s1); return v ? v[0] : def;
  }
  function vec(obj, name, def, inst, seq, out) {
    const tr = track(obj, name); if (!tr) return def;
    const v = sample(tr, inst.frame, seq, inst.md.globalSeqs, inst.globalTime, null, out); return v || def;
  }

  // ---------------------------------------------------------------- model data
  const SPECIAL = ['work', 'upgrade', 'alternate', 'victory', 'channel', 'gold', 'lumber', 'swim', 'hit', 'ready', 'fast', 'spell', 'first', 'second', 'third', 'fourth', 'fifth',
    'medium', 'large', 'flesh', 'bone', 'portrait', 'defend', 'morph', 'eattree', 'cinematic', 'talk', 'throw', 'slam', 'looping', 'complete', 'puke', 'swim', 'off', 'flail', 'hit'];
  class ModelData {
    constructor(path, bytes) {
      this.path = path;
      const m = new window.MdxParser.Model(); m.load(bytes); this.m = m;
      this.sequences = m.sequences; this.globalSeqs = Array.from(m.globalSequences || []);
      const all = [].concat(m.bones, m.helpers, m.attachments, m.lights, m.particleEmitters, m.particleEmitters2,
        m.particleEmittersPopcorn || [], m.ribbonEmitters, m.eventObjects, m.collisionShapes);
      const count = Math.max(0, ...all.map(o => o.objectId + 1), m.pivotPoints.length);
      this.nodes = [];
      for (let i = 0; i < count; i++) this.nodes.push({ id: i, parent: -1, pivot: m.pivotPoints[i] || new Float32Array(3), t: null, r: null, s: null, flags: 0, name: '' });
      for (const o of all) {
        const n = this.nodes[o.objectId]; if (!n) continue;
        n.parent = o.parentId; n.flags = o.flags || 0; n.name = o.name;
        n.t = track(o, 'KGTR'); n.r = track(o, 'KGRT'); n.s = track(o, 'KGSC');
        n.attachment = m.attachments.includes(o);
      }
      const depth = (n, d = 0) => (n.parent >= 0 && n.parent < count && d < 64) ? depth(this.nodes[n.parent], d + 1) + 1 : 0;
      this.order = this.nodes.slice().sort((a, b) => depth(a) - depth(b)).map(n => n.id);
      this.geosets = m.geosets.map((g, gi) => this.buildGeoset(g, gi, m.version));
      this.geosetAnims = {};
      for (const ga of m.geosetAnimations) this.geosetAnims[ga.geosetId] = ga;
      this.extent = { min: Array.from(m.extent.min), max: Array.from(m.extent.max) };
      if (!(this.extent.max[2] - this.extent.min[2] > 1)) this.computeExtent();
      this.body = this.bodyExtent() || this.extent;
      this.attachments = m.attachments.map(a => ({ id: a.objectId, name: a.name.toLowerCase() }));
    }
    bodyExtent() { // bounds of the solid geometry only (no glows, shadows or effect planes)
      const m = this.m; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; let any = false;
      m.geosets.forEach((g) => {
        if (g.lod > 0) return; const mat = m.materials[g.materialId]; if (!mat || !mat.layers.length) return;
        const l = mat.layers[0]; const t = m.textures[l.textureId];
        if (l.filterMode >= 2 || (t && t.replaceableId === 2)) return;
        for (let i = 0; i < g.vertices.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.vertices[i + k]); mx[k] = Math.max(mx[k], g.vertices[i + k]); any = true; }
      });
      return any ? { min: mn, max: mx } : null;
    }
    computeExtent() {
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const g of this.m.geosets) for (let i = 0; i < g.vertices.length; i += 3)
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.vertices[i + k]); mx[k] = Math.max(mx[k], g.vertices[i + k]); }
      this.extent = { min: mn, max: mx };
    }
    buildGeoset(g, gi, version) {
      const geo = new THREE.BufferGeometry();
      const vc = g.vertices.length / 3;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.vertices), 3));
      if (g.normals && g.normals.length === g.vertices.length) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.normals), 3));
      const uv = (g.uvSets && g.uvSets[0]) ? new Float32Array(g.uvSets[0]) : new Float32Array(vc * 2);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(new Uint16Array(g.faces), 1));
      const si = new Uint16Array(vc * 4), sw = new Float32Array(vc * 4);
      if (version > 800 && g.skin && g.skin.length >= vc * 8) {
        for (let v = 0; v < vc; v++) {
          let tot = 0;
          for (let k = 0; k < 4; k++) {
            const bi = g.skin[v * 8 + k]; const w = g.skin[v * 8 + 4 + k];
            si[v * 4 + k] = g.matrixIndices[bi] != null ? g.matrixIndices[bi] : bi; sw[v * 4 + k] = w / 255; tot += w;
          }
          if (!tot) sw[v * 4] = 1;
        }
      } else {
        const groups = []; let off = 0;
        for (const size of g.matrixGroups) { groups.push(Array.from(g.matrixIndices.slice(off, off + size))); off += size; }
        for (let v = 0; v < vc; v++) {
          const grp = groups[g.vertexGroups[v]] || [0]; const n = Math.min(4, grp.length) || 1;
          for (let k = 0; k < 4; k++) { si[v * 4 + k] = k < n ? grp[k] : 0; sw[v * 4 + k] = k < n ? 1 / n : 0; }
        }
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geo.computeBoundingSphere();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      return { geo, materialId: g.materialId, index: gi, lod: g.lod || 0 };
    }
    // pick a sequence like Warcraft does: all wanted words present (tag + animation props), no other special words
    sequence(tag, rng, props) {
      const seqs = this.sequences; const want = tag.toLowerCase().split(' ').concat((props || []).map(p => p.toLowerCase()));
      const words = (s) => s.name.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
      const pick = (want) => seqs.map((s, i) => ({ s, i, w: words(s) }))
        .filter(x => x.w[0] === want[0] && want.every(t => x.w.includes(t)) && x.w.every(t => want.includes(t) || !SPECIAL.includes(t)));
      let c = pick(want);
      if (!c.length && props && props.length) c = pick(tag.toLowerCase().split(' '));
      if (!c.length) c = seqs.map((s, i) => ({ s, i })).filter(x => x.s.name.toLowerCase().startsWith(want[0]));
      if (!c.length) return -1;
      // WC3 uses the rarity field to weight variations; prefer common ones
      const weights = c.map(x => 1 / (1 + (x.s.rarity || 0)));
      let r = (rng || Math.random)() * weights.reduce((a, b) => a + b, 0);
      for (let k = 0; k < c.length; k++) { r -= weights[k]; if (r <= 0) return c[k].i; }
      return c[c.length - 1].i;
    }
  }

  function load(path) {
    const key = A.modelKey(path); if (!key) return null;
    if (models.has(key)) return models.get(key);
    let md = null;
    const bytes = A.get(key);
    if (bytes) { try { md = new ModelData(key, bytes); } catch (e) { console.warn('model parse failed', key, e); } }
    models.set(key, md); return md;
  }

  // ---------------------------------------------------------------- blending
  function applyLayerBlend(P, filter) { // MDX layer filter modes
    if (filter === 1) P.alphaTest = 0.75;
    else if (filter >= 2) { P.transparent = true; P.depthWrite = false; }
    if (filter === 3) { P.blending = THREE.CustomBlending; P.blendSrc = THREE.SrcColorFactor; P.blendDst = THREE.OneFactor; }
    if (filter === 4) { P.blending = THREE.CustomBlending; P.blendSrc = THREE.SrcAlphaFactor; P.blendDst = THREE.OneFactor; }
    if (filter === 5) { P.blending = THREE.CustomBlending; P.blendSrc = THREE.ZeroFactor; P.blendDst = THREE.SrcColorFactor; }
    if (filter === 6) { P.blending = THREE.CustomBlending; P.blendSrc = THREE.DstColorFactor; P.blendDst = THREE.SrcColorFactor; }
  }
  function applyParticleBlend(P, filter) { // particle emitter 2 filter modes
    P.transparent = true; P.depthWrite = false; P.blending = THREE.CustomBlending;
    if (filter === 0) { P.blendSrc = THREE.SrcAlphaFactor; P.blendDst = THREE.OneMinusSrcAlphaFactor; }
    else if (filter === 1) { P.blendSrc = THREE.SrcAlphaFactor; P.blendDst = THREE.OneFactor; }
    else if (filter === 2) { P.blendSrc = THREE.ZeroFactor; P.blendDst = THREE.SrcColorFactor; }
    else if (filter === 3) { P.blendSrc = THREE.DstColorFactor; P.blendDst = THREE.SrcColorFactor; }
    else { P.blendSrc = THREE.SrcAlphaFactor; P.blendDst = THREE.OneMinusSrcAlphaFactor; P.alphaTest = 0.5; P.depthWrite = true; }
  }

  // ---------------------------------------------------------------- particles (emitter type 2)
  const _M = new THREE.Matrix4(), _R = new THREE.Matrix4(), _P = new THREE.Vector3(), _V = new THREE.Vector3(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3();
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _d = new THREE.Vector3(), _side = new THREE.Vector3();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  class Particles2 {
    constructor(inst, e) {
      this.inst = inst; this.e = e; this.node = e.objectId; this.acc = 0; this.list = []; this.lastFrame = null;
      this.head = e.headOrTail === 0 || e.headOrTail === 2; this.tail = e.headOrTail === 1 || e.headOrTail === 2;
      this.modelSpace = !!(e.flags & 0x80000); this.xy = !!(e.flags & 0x100000); this.line = !!(e.flags & 0x20000);
      this.max = 0; this.ensure(32);
      const tex = inst.md.m.textures[e.textureId];
      let map = null; const P = { vertexColors: true, side: THREE.DoubleSide };
      if (tex && tex.replaceableId) map = teamTexture(tex.replaceableId, inst.teamHex) || (tex.replaceableId === 2 ? glowTexture() : null);
      else if (tex && tex.path) map = A.texture(tex.path, tex.wrapMode);
      this.ok = !!map || (tex && tex.replaceableId === 1);
      P.map = map; applyParticleBlend(P, e.filterMode);
      this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial(P));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 200 + (e.priorityPlane || 0);
      inst.fxRoot.add(this.mesh);
    }
    ensure(n) {
      if (n <= this.max) return; this.max = Math.max(n, this.max * 2);
      const quads = this.max * (this.head && this.tail ? 2 : 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quads * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(quads * 4 * 2), 2).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(quads * 4 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const idx = new Uint32Array(quads * 6);
      for (let q = 0; q < quads; q++) { const o = q * 4; idx.set([o, o + 1, o + 2, o, o + 2, o + 3], q * 6); }
      g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
      if (this.geo) this.geo.dispose();
      this.geo = g; if (this.mesh) this.mesh.geometry = g;
    }
    emitOne(seq, fw, scale) {
      const e = this.e, inst = this.inst;
      const width = scalar(e, 'KP2W', e.width, inst, seq) * 0.5, length = scalar(e, 'KP2N', e.length, inst, seq) * 0.5;
      const speed = scalar(e, 'KP2S', e.speed, inst, seq), variation = scalar(e, 'KP2R', e.variation, inst, seq);
      const lat = scalar(e, 'KP2L', e.latitude, inst, seq) * Math.PI / 180;
      const pv = inst.md.nodes[this.node].pivot;
      _P.set(pv[0] + rand(-width, width), pv[1] + rand(-length, length), pv[2]);
      // direction: +Z tilted by up to "latitude" (in a plane for line emitters)
      _R.makeRotationZ(Math.PI / 2); _M.makeRotationY(rand(-lat, lat)); _R.multiply(_M);
      if (!this.line) { _M.makeRotationX(rand(-lat, lat)); _R.multiply(_M); }
      _V.copy(Z_AXIS).applyMatrix4(_R);
      const nw = inst.world[this.node];
      const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0 };
      const sp = speed * (1 + rand(-variation, variation));
      if (this.modelSpace) {
        _P.applyMatrix4(nw); _V.transformDirection(nw).multiplyScalar(sp);
      } else {
        _M.multiplyMatrices(fw, nw); _P.applyMatrix4(_M); _V.transformDirection(_M).multiplyScalar(sp * scale);
      }
      p.x = _P.x; p.y = _P.y; p.z = _P.z; p.vx = _V.x; p.vy = _V.y; p.vz = _V.z;
      this.list.push(p);
    }
    update(dt, seq, camera, emitting) {
      const e = this.e, inst = this.inst;
      const fw = inst.group.matrixWorld; _S.setFromMatrixScale(fw); const scale = _S.x;
      const visible = scalar(e, 'KP2V', 1, inst, seq) > 0;
      if (emitting && visible && this.ok !== false) {
        if (e.squirt) {
          const tr = track(e, 'KP2E');
          if (tr && seq && this.lastFrame != null && inst.frame >= this.lastFrame) {
            for (let k = 0; k < tr.frames.length; k++) {
              const f = tr.frames[k]; if (f > this.lastFrame && f <= inst.frame && f >= seq.interval[0] && f <= seq.interval[1]) for (let n = 0; n < tr.values[k][0]; n++) this.emitOne(seq, fw, scale);
            }
          }
        } else {
          this.acc += scalar(e, 'KP2E', e.emissionRate, inst, seq) * dt;
          let n = Math.floor(this.acc); this.acc -= n; n = Math.min(n, 200);
          for (let i = 0; i < n; i++) this.emitOne(seq, fw, scale);
        }
      }
      this.lastFrame = inst.frame;
      const g = scalar(e, 'KP2G', e.gravity, inst, seq) * (this.modelSpace ? 1 : scale);
      const life = e.lifeSpan || 1;
      // age / move
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i]; p.age += dt;
        if (p.age >= life) { L[i] = L[L.length - 1]; L.pop(); continue; }
        p.vz -= g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      this.ensure(L.length);
      // build quads
      const pos = this.geo.attributes.position.array, uv = this.geo.attributes.uv.array, col = this.geo.attributes.color.array;
      _right.set(1, 0, 0).applyQuaternion(camera.quaternion); _up.set(0, 1, 0).applyQuaternion(camera.quaternion); _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const tm = e.timeMiddle, cols = e.columns || 1, rows = e.rows || 1;
      const nw = this.modelSpace ? _M.multiplyMatrices(fw, inst.world[this.node]) : null;
      let q = 0;
      const seg = (arr, f) => f < tm ? arr[0] + (arr[1] - arr[0]) * (f / tm) : arr[1] + (arr[2] - arr[1]) * ((f - tm) / Math.max(1e-6, 1 - tm));
      const C = e.segmentColors, AL = e.segmentAlphas, SC = e.segmentScaling;
      for (const p of L) {
        const f = p.age / life;
        const k = f < tm ? f / tm : (f - tm) / Math.max(1e-6, 1 - tm); const ci = f < tm ? 0 : 1;
        const r = f < tm ? C[0][0] + (C[1][0] - C[0][0]) * k : C[1][0] + (C[2][0] - C[1][0]) * k;
        const gg = f < tm ? C[0][1] + (C[1][1] - C[0][1]) * k : C[1][1] + (C[2][1] - C[1][1]) * k;
        const b = f < tm ? C[0][2] + (C[1][2] - C[0][2]) * k : C[1][2] + (C[2][2] - C[1][2]) * k;
        const a = seg(AL, f) / 255; const size = seg(SC, f) * (this.modelSpace ? scale : scale) * 0.5;
        _P.set(p.x, p.y, p.z); if (nw) _P.applyMatrix4(nw);
        for (let part = 0; part < 2; part++) {
          if (part === 0 && !this.head) continue; if (part === 1 && !this.tail) continue;
          const iv = (part === 0 ? e.headIntervals : e.tailIntervals)[ci] || [0, 0, 1];
          const span = iv[1] - iv[0]; let cell = iv[0];
          if (span > 0) cell = iv[0] + Math.floor(span * Math.max(1, iv[2] || 1) * k) % (span + 1);
          const u0 = (cell % cols) / cols, v0 = Math.floor(cell / cols) / rows, u1 = u0 + 1 / cols, v1 = v0 + 1 / rows;
          const o = q * 12;
          if (part === 0) {
            if (this.xy) { _side.set(size, 0, 0); _d.set(0, size, 0); } else { _side.copy(_right).multiplyScalar(size); _d.copy(_up).multiplyScalar(size); }
            pos[o] = _P.x - _side.x - _d.x; pos[o + 1] = _P.y - _side.y - _d.y; pos[o + 2] = _P.z - _side.z - _d.z;
            pos[o + 3] = _P.x + _side.x - _d.x; pos[o + 4] = _P.y + _side.y - _d.y; pos[o + 5] = _P.z + _side.z - _d.z;
            pos[o + 6] = _P.x + _side.x + _d.x; pos[o + 7] = _P.y + _side.y + _d.y; pos[o + 8] = _P.z + _side.z + _d.z;
            pos[o + 9] = _P.x - _side.x + _d.x; pos[o + 10] = _P.y - _side.y + _d.y; pos[o + 11] = _P.z - _side.z + _d.z;
            uv.set([u0, v1, u1, v1, u1, v0, u0, v0], q * 8);
          } else {
            const tl = e.tailLength; _d.set(p.vx, p.vy, p.vz).multiplyScalar(tl);
            _side.crossVectors(_d, _fwd); const sl = _side.length(); if (sl < 1e-6) _side.copy(_right); else _side.multiplyScalar(1 / sl);
            _side.multiplyScalar(size);
            const ex = _P.x - _d.x, ey = _P.y - _d.y, ez = _P.z - _d.z;
            pos[o] = ex - _side.x; pos[o + 1] = ey - _side.y; pos[o + 2] = ez - _side.z;
            pos[o + 3] = ex + _side.x; pos[o + 4] = ey + _side.y; pos[o + 5] = ez + _side.z;
            pos[o + 6] = _P.x + _side.x; pos[o + 7] = _P.y + _side.y; pos[o + 8] = _P.z + _side.z;
            pos[o + 9] = _P.x - _side.x; pos[o + 10] = _P.y - _side.y; pos[o + 11] = _P.z - _side.z;
            uv.set([u0, v1, u1, v1, u1, v0, u0, v0], q * 8);
          }
          const tc = this.teamTint;
          for (let v = 0; v < 4; v++) { const c = q * 16 + v * 4; col[c] = r * (tc ? tc.r : 1); col[c + 1] = gg * (tc ? tc.g : 1); col[c + 2] = b * (tc ? tc.b : 1); col[c + 3] = a * inst.opacity; }
          q++;
        }
      }
      this.geo.setDrawRange(0, q * 6);
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
      return L.length;
    }
    dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mesh.material.dispose(); }
  }

  // ---------------------------------------------------------------- ribbons
  class Ribbon {
    constructor(inst, e) {
      this.inst = inst; this.e = e; this.node = e.objectId; this.acc = 0; this.list = []; this.max = 0;
      const mat = inst.md.m.materials[e.materialId]; const layer = mat && mat.layers[0];
      const tex = layer && inst.md.m.textures[layer.textureId];
      let map = null;
      if (tex && tex.replaceableId) map = teamTexture(tex.replaceableId, inst.teamHex) || (tex.replaceableId === 2 ? glowTexture() : null);
      else if (tex && tex.path) map = A.texture(tex.path, tex.wrapMode);
      this.ok = !!map;
      const P = { map, vertexColors: true, side: THREE.DoubleSide }; applyLayerBlend(P, layer ? layer.filterMode : 2);
      P.transparent = true; P.depthWrite = false;
      this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(P));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 190; inst.fxRoot.add(this.mesh);
      this.ensure(32);
    }
    ensure(n) {
      if (n <= this.max) return; this.max = Math.max(n, this.max * 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.max * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.max * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const idx = new Uint32Array(this.max * 6);
      for (let i = 0; i < this.max - 1; i++) { const o = i * 2; idx.set([o, o + 1, o + 3, o, o + 3, o + 2], i * 6); }
      g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
      this.mesh.geometry.dispose(); this.mesh.geometry = g; this.geo = g;
    }
    update(dt, seq, camera, emitting) {
      const e = this.e, inst = this.inst; const L = this.list; const life = e.lifeSpan || 1;
      const fw = inst.group.matrixWorld; _S.setFromMatrixScale(fw); const scale = _S.x;
      for (const p of L) p.age += dt;
      while (L.length && L[0].age >= life) L.shift();
      const visible = scalar(e, 'KRVS', 1, inst, seq) > 0;
      if (emitting && visible && this.ok) {
        this.acc += e.emissionRate * dt; let n = Math.floor(this.acc); this.acc -= n; n = Math.min(n, 8);
        if (n > 0 || !L.length) {
          const ha = scalar(e, 'KRHA', e.heightAbove, inst, seq), hb = scalar(e, 'KRHB', e.heightBelow, inst, seq);
          const pv = inst.md.nodes[this.node].pivot; _M.multiplyMatrices(fw, inst.world[this.node]);
          const a = new THREE.Vector3(pv[0], pv[1] + ha, pv[2]).applyMatrix4(_M), b = new THREE.Vector3(pv[0], pv[1] - hb, pv[2]).applyMatrix4(_M);
          const c = vec(e, 'KRCO', e.color, inst, seq, new Float32Array(3)); const al = scalar(e, 'KRAL', e.alpha, inst, seq);
          const slot = scalar(e, 'KRTX', 0, inst, seq) | 0;
          L.push({ a, b, age: 0, c: [c[0], c[1], c[2]], al, slot });
        }
      }
      if (L.length > 1) {
        this.ensure(L.length);
        const pos = this.geo.attributes.position.array, uv = this.geo.attributes.uv.array, col = this.geo.attributes.color.array;
        const cols = e.columns || 1, rows = e.rows || 1;
        L.forEach((p, i) => {
          const drop = 0.5 * (e.gravity || 0) * scale * p.age * p.age;
          pos.set([p.a.x, p.a.y, p.a.z - drop, p.b.x, p.b.y, p.b.z - drop], i * 6);
          const u = 1 - p.age / life; const cu = (p.slot % cols) / cols, cv = Math.floor(p.slot / cols) / rows;
          uv.set([cu + u / cols, cv, cu + u / cols, cv + 1 / rows], i * 4);
          const a = p.al * (1 - 0) * inst.opacity;
          col.set([p.c[0], p.c[1], p.c[2], a, p.c[0], p.c[1], p.c[2], a], i * 8);
        });
        this.geo.setDrawRange(0, (L.length - 1) * 6);
        this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
      } else this.geo.setDrawRange(0, 0);
      return L.length;
    }
    dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mesh.material.dispose(); }
  }

  // ---------------------------------------------------------------- instance
  const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const _tmp3 = new Float32Array(3), _tmp4 = new Float32Array(4), _tmp1 = new Float32Array(1), _c3 = new Float32Array(3);
  class Instance {
    // opts: team (hex colour), fxRoot (world-space parent for particles/ribbons), props (animation props), onEvent(name, worldPos)
    constructor(md, opts = {}) {
      this.md = md; this.group = new THREE.Group(); this.team = new THREE.Color(opts.team || '#ff0303'); this.teamHex = String(opts.team || '#ff0303').toLowerCase();
      this.fxRoot = opts.fxRoot || this.group; this.props = opts.props || []; this.onEvent = opts.onEvent || null;
      this.frame = 0; this.globalTime = 0; this.seq = -1; this.loop = true; this.speed = 1; this.done = false; this.emitting = true;
      this.bones = md.nodes.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; return b; });
      this.world = md.nodes.map(() => new THREE.Matrix4());
      this.skeleton = new THREE.Skeleton(this.bones, md.nodes.map(() => new THREE.Matrix4()));
      this.meshes = []; this.opacity = 1;
      const m = md.m;
      for (const gs of md.geosets) {
        if (gs.lod > 0) continue;
        const mat = m.materials[gs.materialId]; if (!mat) continue;
        const brokenFx = mat.layers.some(l => { const t = m.textures[l.textureId]; return l.filterMode >= 2 && t && !t.replaceableId && t.path && !A.hasTexture(t.path); });
        if (brokenFx) continue;
        mat.layers.forEach((layer, li) => {
          const material = this.makeMaterial(layer, mat, li);
          if (!material) return;
          const mesh = new THREE.SkinnedMesh(gs.geo, material);
          mesh.bind(this.skeleton, new THREE.Matrix4()); mesh.bindMode = 'detached';
          mesh.frustumCulled = false; mesh.renderOrder = (mat.priorityPlane || 0) * 10 + li + (material.transparent ? 100 : 0);
          mesh.userData = { geoset: gs.index, layer, baseOpacity: material.opacity, baseColor: material.color.clone() };
          this.group.add(mesh); this.meshes.push(mesh);
        });
      }
      this.particles = (m.particleEmitters2 || []).map(e => new Particles2(this, e));
      for (const p of this.particles) { const tex = m.textures[p.e.textureId]; if (tex && tex.replaceableId === 1) p.teamTint = this.team; }
      this.ribbons = (m.ribbonEmitters || []).map(e => new Ribbon(this, e));
      this.events = (m.eventObjects || []).filter(e => /^(SPN|SPL|UBR)/.test(e.name));
      this.lastEventFrame = null;
      this.play('stand');
      this.update(0);
    }
    makeMaterial(layer, mat, li) {
      const m = this.md.m; const tex = m.textures[layer.textureId];
      const filter = layer.filterMode; const flags = layer.flags;
      const unshaded = !!(flags & 1); const twoSided = !!(flags & 16) || !!(mat.flags & 2);
      let map = null, color = new THREE.Color(1, 1, 1); let team = false;
      if (tex && tex.replaceableId === 1) { color = this.team.clone(); team = true; }
      else if (tex && tex.replaceableId === 2) { map = teamTexture(2, this.teamHex); if (!map) { map = glowTexture(); color = this.team.clone(); } team = true; }
      else if (tex && tex.replaceableId > 2) { color = new THREE.Color(0.35, 0.45, 0.3); }
      else if (tex && tex.path) {
        map = A.texture(tex.path, tex.wrapMode);
        if (!map) { if (filter >= 2) return null; color = hashColor(tex.path); }
      }
      if (map && layer.textureAnimationId >= 0 && m.textureAnimations[layer.textureAnimationId]) { map = map.clone(); map.needsUpdate = true; map.matrixAutoUpdate = true; }
      const P = { color, map, side: twoSided ? THREE.DoubleSide : THREE.FrontSide, transparent: false };
      applyLayerBlend(P, filter);
      if (flags & 64) P.depthTest = false;
      if (flags & 128) P.depthWrite = false;
      P.opacity = layer.alpha != null ? layer.alpha : 1;
      if (P.opacity < 1) P.transparent = true;
      const material = unshaded || filter >= 3 ? new THREE.MeshBasicMaterial(P) : new THREE.MeshLambertMaterial(P);
      material.userData.teamLayer = team; material.userData.replaceable = tex ? tex.replaceableId : 0; material.userData.glowFallback = !!(map && map === _glow.t);
      material.userData.texAnim = layer.textureAnimationId >= 0 ? m.textureAnimations[layer.textureAnimationId] : null;
      material.userData.flip = track(layer, 'KMTF');
      return material;
    }
    setTeamColor(c) {
      this.team.set(c); this.teamHex = String(c).toLowerCase();
      for (const mesh of this.meshes) {
        const ud = mesh.material.userData; if (!ud.teamLayer) continue;
        if (ud.replaceable === 2 && !ud.glowFallback) { const t = teamTexture(2, this.teamHex); if (t) { mesh.material.map = t; mesh.material.needsUpdate = true; } continue; }
        mesh.material.color.copy(this.team); mesh.userData.baseColor.copy(this.team);
      }
    }
    setOpacity(a) { this.opacity = a; }
    setProps(props) { this.props = props || []; }
    play(tag, opts = {}) {
      const i = this.md.sequence(tag, opts.rng, opts.props || this.props);
      if (i < 0) { this.seq = -1; return false; }
      if (i === this.seq && !opts.restart && !this.done) { this.loop = opts.loop !== undefined ? opts.loop : this.loop; return true; }
      this.seq = i; this.tag = tag; const s = this.md.sequences[i];
      this.frame = s.interval[0]; this.done = false; this.lastEventFrame = null;
      this.loop = opts.loop !== undefined ? opts.loop : !s.nonLooping;
      this.speed = opts.speed || 1;
      for (const p of this.particles) p.lastFrame = null;
      return true;
    }
    duration() { const s = this.md.sequences[this.seq]; return s ? (s.interval[1] - s.interval[0]) / 1000 : 0; }
    seqMoveSpeed() { const s = this.md.sequences[this.seq]; return s ? s.moveSpeed : 0; }
    update(dtMs, camera) {
      const md = this.md; const seq = md.sequences[this.seq];
      this.globalTime += dtMs;
      let wrapped = false;
      if (seq) {
        this.frame += dtMs * this.speed;
        if (this.frame > seq.interval[1]) {
          if (this.loop) { const len = Math.max(1, seq.interval[1] - seq.interval[0]); this.frame = seq.interval[0] + ((this.frame - seq.interval[0]) % len); wrapped = true; }
          else { this.frame = seq.interval[1]; this.done = true; }
        }
      }
      const F = this.frame, G = this.globalTime, gs = md.globalSeqs;
      const nodes = md.nodes;
      for (const id of md.order) {
        const n = nodes[id]; const w = this.world[id];
        const t = n.t ? sample(n.t, F, seq, gs, G, DEFAULTS.KGTR, _tmp3) : DEFAULTS.KGTR;
        const tx = t[0], ty = t[1], tz = t[2];
        const r = n.r ? sample(n.r, F, seq, gs, G, DEFAULTS.KGRT, _tmp4) : DEFAULTS.KGRT;
        _q.set(r[0], r[1], r[2], r[3]);
        const s = n.s ? sample(n.s, F, seq, gs, G, DEFAULTS.KGSC, _tmp3) : DEFAULTS.KGSC;
        _s.set(s[0], s[1], s[2]);
        const pv = n.pivot;
        _m.compose(_v.set(pv[0] + tx, pv[1] + ty, pv[2] + tz), _q, _s);
        _t.makeTranslation(-pv[0], -pv[1], -pv[2]); _m.multiply(_t);
        if (n.parent >= 0 && n.parent < nodes.length && n.parent !== id) w.multiplyMatrices(this.world[n.parent], _m); else w.copy(_m);
        if ((n.flags & 8) && camera) this.billboard(w, n, camera);
        this.bones[id].matrixWorld.copy(w);
      }
      this.skeleton.update();
      // geoset / layer visibility, colour, texture animation
      for (const mesh of this.meshes) {
        const ud = mesh.userData; let a = ud.baseOpacity; const mat = mesh.material;
        const ga = md.geosetAnims[ud.geoset];
        if (ga) {
          const ka = track(ga, 'KGAO');
          a *= ka ? sample(ka, F, seq, gs, G, [ga.alpha != null ? ga.alpha : 1], _tmp1)[0] : (ga.alpha != null ? ga.alpha : 1);
          if (!mat.userData.teamLayer) {
            const kc = track(ga, 'KGAC'); const c = kc ? sample(kc, F, seq, gs, G, null, _c3) : (ga.color && (ga.flags & 2) ? ga.color : null);
            if (c) mat.color.setRGB(ud.baseColor.r * c[2], ud.baseColor.g * c[1], ud.baseColor.b * c[0]);
          }
        }
        const la = track(ud.layer, 'KMTA'); if (la) a *= sample(la, F, seq, gs, G, [1], _tmp1)[0];
        a *= this.opacity;
        mesh.visible = a > 0.02;
        if (mat.opacity !== a) { mat.opacity = a; if (a < 1 && !mat.transparent) { mat.transparent = true; mat.depthWrite = false; mat.needsUpdate = true; } }
        const ta = mat.userData.texAnim;
        if (ta && mat.map) {
          const tt = vec(ta, 'KTAT', null, this, seq, new Float32Array(3)); const ts = vec(ta, 'KTAS', null, this, seq, new Float32Array(3));
          if (tt) mat.map.offset.set(tt[0], -tt[1]); if (ts) mat.map.repeat.set(ts[0], ts[1]);
        }
        const fl = mat.userData.flip;
        if (fl) { const ti = sample(fl, F, seq, gs, G, null, _tmp1); if (ti) { const tex = md.m.textures[ti[0] | 0]; const map = tex && tex.path ? A.texture(tex.path, tex.wrapMode) : null; if (map && mat.map !== map) { mat.map = map; mat.needsUpdate = true; } } }
      }
      // particles / ribbons (world space)
      if (camera && (this.particles.length || this.ribbons.length)) {
        const dt = dtMs / 1000;
        this.liveFx = 0;
        for (const p of this.particles) this.liveFx += p.update(dt, seq, camera, this.emitting && this.opacity > 0.05);
        for (const r of this.ribbons) this.liveFx += r.update(dt, seq, camera, this.emitting && this.opacity > 0.05);
      } else this.liveFx = 0;
      // event objects (blood spawns, splats)
      if (this.onEvent && this.events.length && seq) {
        const from = this.lastEventFrame, to = F;
        if (from != null) for (const e of this.events) for (const t of e.tracks) {
          if (t < seq.interval[0] || t > seq.interval[1]) continue;
          if ((!wrapped && t > from && t <= to) || (wrapped && (t > from || t <= to))) {
            const pv = md.nodes[e.objectId].pivot;
            const wp = new THREE.Vector3(pv[0], pv[1], pv[2]).applyMatrix4(this.world[e.objectId]).applyMatrix4(this.group.matrixWorld);
            this.onEvent(e.name, wp);
          }
        }
        this.lastEventFrame = F;
      }
    }
    billboard(w, n, camera) {
      _p.set(n.pivot[0], n.pivot[1], n.pivot[2]).applyMatrix4(w);
      const inv = _t.copy(this.group.matrixWorld).invert();
      const cz = _v.set(0, 0, 1).applyQuaternion(camera.quaternion);
      const cx = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const cy = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const rot = new THREE.Matrix4().makeBasis(cz, cx, cy);
      rot.premultiply(new THREE.Matrix4().extractRotation(inv));
      _s.setFromMatrixScale(w);
      w.copy(rot).scale(_s).setPosition(_p);
      _t.makeTranslation(-n.pivot[0], -n.pivot[1], -n.pivot[2]); w.multiply(_t);
    }
    // model-space position of an attachment point ("overhead", "chest", "origin", "weapon", "head", "hand left" ...)
    attachment(name) {
      name = String(name || 'origin').toLowerCase();
      const a = this.md.attachments.find(x => x.name.includes(name + ' ref')) || this.md.attachments.find(x => x.name.includes(name));
      if (!a) return null;
      const n = this.md.nodes[a.id];
      return new THREE.Vector3(n.pivot[0], n.pivot[1], n.pivot[2]).applyMatrix4(this.world[a.id]);
    }
    get busy() { return this.liveFx > 0; } // particles still alive after the model stopped emitting
    stopEmitting() { this.emitting = false; }
    dispose() {
      for (const mesh of this.meshes) { if (mesh.material.userData.texAnim && mesh.material.map) mesh.material.map.dispose(); mesh.material.dispose(); }
      for (const p of this.particles) p.dispose(); for (const r of this.ribbons) r.dispose();
      this.group.removeFromParent();
    }
  }

  // ---------------------------------------------------------------- lights (day/night models)
  function lightAt(md, frame) { // -> {dir: Vector3, color: [r,g,b] * intensity, ambient: [r,g,b] * ambientIntensity}
    const l = md.m.lights[0]; if (!l) return null;
    const seq = md.sequences[0]; const fake = { frame, globalTime: 0, md };
    const c = vec(l, 'KLAC', l.color, fake, seq, new Float32Array(3)), i = scalar(l, 'KLAI', l.intensity, fake, seq);
    const ac = vec(l, 'KLBC', l.ambientColor, fake, seq, new Float32Array(3)), ai = scalar(l, 'KLBI', l.ambientIntensity, fake, seq);
    const node = md.nodes[l.objectId]; const r = node.r ? sample(node.r, frame, seq, md.globalSeqs, 0, DEFAULTS.KGRT, new Float32Array(4)) : DEFAULTS.KGRT;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r[0], r[1], r[2], r[3]));
    return { dir, color: [c[0] * i, c[1] * i, c[2] * i], ambient: [ac[0] * ai, ac[1] * ai, ac[2] * ai], seq };
  }

  window.PyroMDX = { load, Instance, hashColor, lightAt };
})();
