global.window = {};
require('../src/gamedata.js'); require('../src/engine.js'); require('../src/rules.js'); require('../src/ai.js');
const { World, Rules, AI } = window.Pyro;
const w = new World({ seed: 7 });
for (const id of [2,3,6,7]) { w.players[id].playing = true; w.players[id].kind = 'ai'; }
const r = new Rules(w, {}); new AI(w, r); r.start();
let structDmg = 0, kills = {};
w.on('damaged', (t, s, d) => { if (t.structure) structDmg += d; });
w.on('death', (u, k) => { const key = (k ? (k.structure ? 'struct:' + k.typeId : 'unit') : 'none') + '->' + u.typeId; kills[key] = (kills[key] || 0) + 1; });
w.on('roundEnd', n => { console.log('round', n, 'structDmg', Math.round(structDmg), JSON.stringify(kills)); structDmg = 0; kills = {}; });
let sampled = {};
while (!w.over && w.time < 1300) {
  w.step();
  if (r.phase === 'fight' && !sampled[r.round] && w.time - r.fightStart > 6) {
    sampled[r.round] = 1;
    const us = w.units.filter(u => u.alive() && !u.structure && (u.owner === 0 || u.owner === 1));
    console.log('  sample r' + r.round, us.slice(0, 6).map(u => `${u.typeId}@${Math.round(u.x)},${Math.round(u.y)} o${u.owner} ${u.order.type} tgt=${u.target ? u.target.typeId : '-'}`).join(' | '));
  }
}
