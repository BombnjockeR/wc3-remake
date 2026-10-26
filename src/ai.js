/* Simple computer opponent for testing. NOT part of the original map: Pyro TD 0.31's bot triggers are empty
 * stubs, so this was written for the web port. It builds and upgrades towers along its team's maze and buys
 * abilities on evolution towers. Tune the weights in PLAN to change how it plays.
 */
(function () {
  'use strict';
  const D = window.PYRO_DATA;
  const { rectCenter, inRect } = window.Pyro;

  // How much the AI likes each kind of investment (relative weights)
  const PLAN = {
    heal: 6, weapon: 4, armor: 3, goldmine: 3, frost: 1.5, evolution: 2.5, buyAbility: 2.5, trainer: 1.5, rulebreaker: 0.8,
  };

  class AI {
    constructor(world, rules) {
      this.w = world; this.r = rules; this.spots = [null, null]; this.stats = [[], []];
      world.on('teleported', () => {});
      this.timer = world.every(1.5, () => this.think(), 1);
      // remember how healthy our units arrived in the middle (used to decide if we need more healing)
      const origTeleport = rules.teleport.bind(rules);
      rules.teleport = (u) => { const team = u.flags.maze; this.stats[team].push(u.lifePct()); if (this.stats[team].length > 10) this.stats[team].shift(); origTeleport(u); };
      world.on('raceVote', () => {
        for (const p of world.players) if (p.kind === 'ai' && p.playing) {
          const races = Object.keys(rules.RACES);
          world.after(1 + world.rng.next() * 5, () => rules.voteRace(p.id, world.rng.pick(races)));
        }
      });
    }
    // ---- candidate tower spots for a team, scored by how much of the maze path they cover
    pathPoints(team) {
      const pre = team === 0 ? 'gr1' : 'gr2';
      const pts = [rectCenter(this.r.R(pre + '_start'))];
      for (let i = 1; i <= 9; i++) pts.push(rectCenter(this.r.R(pre + '_wp' + i)));
      pts.push(rectCenter(this.r.R(pre + '_goal')));
      const samples = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1]; const d = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.ceil(d / 48);
        for (let k = 0; k < n; k++) samples.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, i });
      }
      return samples;
    }
    getSpots(team) {
      if (this.spots[team]) return this.spots[team];
      const area = this.r.R(team === 0 ? 'Team_1_Area' : 'Team_2_Area');
      const samples = this.pathPoints(team);
      const list = [];
      for (let x = area[0] + 96; x <= area[2] - 96; x += 64)
        for (let y = area[1] + 96; y <= area[3] - 96; y += 64) {
          if (!this.w.grid.canPlace(x, y, 4)) continue;
          const cov = {};
          for (const R of [500, 550, 600, 650, 750, 800]) cov[R] = samples.filter(s => Math.hypot(s.x - x, s.y - y) <= R).length;
          const early = samples.filter(s => Math.hypot(s.x - x, s.y - y) <= 650 && s.i <= 4).length;
          list.push({ x, y, cov, early });
        }
      this.spots[team] = list;
      return list;
    }
    bestSpot(pid, typeId) {
      const team = this.w.players[pid].team; const def = D.units[typeId];
      const R = [500, 550, 600, 650, 750, 800].reduce((a, b) => Math.abs(b - def.range) < Math.abs(a - def.range) ? b : a, 650);
      let cands = this.getSpots(team).filter(s => this.r.canBuildAt(pid, typeId, s.x, s.y));
      if (!cands.length) return null;
      // gold towers don't need path coverage; keep them away from good spots
      const score = s => (this.r.T.goldtowers.includes(typeId) ? -s.cov[650] : s.cov[R] + (typeId === 'h004' ? s.early : 0)) + this.w.rng.next() * 3;
      cands.sort((a, b) => score(b) - score(a));
      return cands[0];
    }
    mine(pid) { return this.w.units.filter(u => u.alive() && u.owner === pid && u.structure); }
    think() {
      const w = this.w, r = this.r;
      if (w.over || r.phase === 'vote' || r.phase === 'lobby') return;
      for (const p of w.players) if (p.kind === 'ai' && p.playing) this.act(p);
    }
    act(p) {
      const w = this.w, r = this.r, T = r.T; const pid = p.id;
      const towers = this.mine(pid);
      const busy = towers.some(t => t.building);
      if (busy && w.rng.next() < 0.5) return;
      const gold = p.gold;
      const team = p.team;
      const health = this.stats[team].length ? this.stats[team].reduce((a, b) => a + b, 0) / this.stats[team].length : 0;
      const count = (ids) => towers.filter(t => ids.includes(t.typeId)).length;
      const priests = towers.filter(t => T.priestHeal[t.typeId] != null);
      const options = [];
      const add = (w8, cost, fn, label) => { if (cost <= gold) options.push({ w: w8, cost, fn, label }); };
      // healing: new priest or upgrade the weakest priest
      const healNeed = priests.length < 2 ? 3 : (health < 99 ? 2 : 0.4);
      add(PLAN.heal * healNeed * (priests.length < 6 ? 1 : 0.3), 10, () => this.build(pid, 'h000'), 'priest');
      const weakest = priests.filter(t => !t.building && t.def.upgradesTo.includes(this.nextPriest(t.typeId))).sort((a, b) => a.def.hp - b.def.hp)[0];
      if (weakest) add(PLAN.heal * healNeed * 1.5, D.units[this.nextPriest(weakest.typeId)].cost, () => r.cmdUpgrade(weakest, this.nextPriest(weakest.typeId)), 'priest up');
      // weapon / armor smiths
      this.lineOptions(pid, towers, add, 'h002', ['h002', 'h00E', 'h00U', 'h01H', 'h01I', 'h01J'], PLAN.weapon * (health > 80 ? 1.2 : 0.5));
      this.lineOptions(pid, towers, add, 'h00L', ['h00L', 'h00M', 'h00V', 'h01K', 'h01L', 'h01M'], PLAN.armor * (health > 80 ? 1.2 : 0.5));
      // gold economy
      const gt = r.goldtowerType;
      if (r.round <= 8 && (r.amountGoldTowers[pid] || 0) < 5) add(PLAN.goldmine, D.units[gt].cost, () => this.build(pid, gt), 'goldtower');
      for (const t of towers) {
        if (t.building) continue;
        if (T.goldtowers.includes(t.typeId)) { const to = t.def.upgradesTo.find(x => T.goldmine[x] != null); if (to) add(PLAN.goldmine * 1.5, D.units[to].cost, () => r.cmdUpgrade(t, to), 'goldmine'); }
        else if (T.goldmine[t.typeId] != null && t.def.upgradesTo[0] && r.round < 14) add(PLAN.goldmine * 0.8, D.units[t.def.upgradesTo[0]].cost, () => r.cmdUpgrade(t, t.def.upgradesTo[0]), 'goldmine up');
      }
      // frost mages slow units so they get more buffs
      if (r.round >= 3 && count(['h005', 'h006', 'h007', 'h008']) < 3) add(PLAN.frost, 10, () => this.build(pid, 'h005'), 'frost');
      for (const t of towers) if (t.typeId === 'h005' && !t.building) add(PLAN.frost * 0.6, D.units.h006.cost, () => r.cmdUpgrade(t, 'h006'), 'frost up');
      // evolution towers
      if (r.round >= 4 && health > 90 && count(T.evolution) < 2) add(PLAN.evolution, 100, () => this.build(pid, 'h00G'), 'evolution');
      for (const t of towers) {
        if (t.typeId === 'h00G' && !t.building) {
          const pick = w.rng.pick(['h00H', 'h00H', 'h00O', 'h01D', 'h01F', 'h02V']);
          add(PLAN.evolution * 3, 0, () => r.cmdUpgrade(t, pick), 'evolve type');
        }
        if (r.EVOLVE[t.typeId] && !t.building) {
          for (const [ab, lvl] of Object.entries(t.abil)) {
            const b = r.BUY[ab]; if (!b || lvl >= b.max) continue;
            add(PLAN.buyAbility / (1 + lvl * 0.15), Math.max(b.cost(lvl), b.need ? b.need(lvl) : 0), () => r.cmdBuy(t, ab), 'buy ' + ab);
          }
        }
      }
      // trainers (area buffs) later in the game
      if (r.round >= 6) {
        for (const t of towers) {
          if (t.typeId === 'h00M' && !t.building && count(['h018', 'h04C', 'h019', 'h01R', 'h01S', 'h01A', 'h04B', 'h01B', 'h01T', 'h01U']) < 2) { /* keep the smith line */ }
        }
        if (count(['h002']) > 0) {
          const s = towers.find(t => t.typeId === 'h002' && !t.building);
          if (s) add(PLAN.trainer, D.units.h018.cost, () => r.cmdUpgrade(s, 'h018'), 'weapontrainer');
        }
        if (count(['h00L']) > 0) {
          const s = towers.find(t => t.typeId === 'h00L' && !t.building);
          if (s) add(PLAN.trainer, D.units.h01A.cost, () => r.cmdUpgrade(s, 'h01A'), 'armortrainer');
        }
        for (const t of towers) if (['h018', 'h04C', 'h019', 'h01R', 'h01A', 'h04B', 'h01B', 'h01T'].includes(t.typeId) && !t.building)
          add(PLAN.trainer, D.units[t.def.upgradesTo[0]].cost, () => r.cmdUpgrade(t, t.def.upgradesTo[0]), 'trainer up');
      }
      if (r.round >= 5 && count(Object.keys(T.rulebreaker)) < 1) add(PLAN.rulebreaker, 25, () => this.build(pid, 'h004'), 'rulebreaker');
      if (!options.length) return;
      // save up sometimes so expensive upgrades become possible
      if (w.rng.next() < 0.25 && gold < 300) return;
      const total = options.reduce((a, o) => a + o.w, 0);
      let x = w.rng.next() * total;
      for (const o of options) { x -= o.w; if (x <= 0) { o.fn(); return; } }
    }
    nextPriest(id) { const L = this.r.T.priest; const i = L.indexOf(id); return i >= 0 && i < L.length - 1 ? L[i + 1] : null; }
    lineOptions(pid, towers, add, base, line, weight) {
      const r = this.r;
      const have = towers.filter(t => line.includes(t.typeId));
      if (have.length < 3) add(weight * (have.length ? 0.6 : 1.5), D.units[base].cost, () => this.build(pid, base), 'build ' + base);
      for (const t of have) {
        if (t.building) continue;
        const i = line.indexOf(t.typeId); const to = line[i + 1];
        if (to && t.def.upgradesTo.includes(to)) add(weight, D.units[to].cost, () => r.cmdUpgrade(t, to), 'up ' + to);
      }
    }
    build(pid, typeId) {
      const s = this.bestSpot(pid, typeId); if (!s) return false;
      return this.r.cmdBuild(pid, typeId, s.x, s.y);
    }
  }

  window.Pyro.AI = AI;
})();
