// Headless simulation test: AI vs AI, prints a round-by-round summary.
global.window = {};
require('../src/gamedata.js');
require('../src/engine.js');
require('../src/rules.js');
require('../src/ai.js');
const { World, Rules, AI } = window.Pyro;

function newGame(perTeam, seed, opts = {}) {
  const w = new World({ seed });
  const slots = [[2, 3, 4, 5], [6, 7, 8, 9]];
  for (const t of [0, 1]) for (let i = 0; i < perTeam; i++) {
    const p = w.players[slots[t][i]]; p.playing = true; p.kind = 'ai';
  }
  const r = new Rules(w, {});
  const ai = new AI(w, r);
  r.start();
  return { w, r, ai };
}

const perTeam = +(process.argv[2] || 2), seed = +(process.argv[3] || 7), maxMin = +(process.argv[4] || 40);
const { w, r } = newGame(perTeam, seed);
let lastRound = 0; const t0 = Date.now();
w.on('roundEnd', (n) => {
  const c = [r.castleOf(0), r.castleOf(1)];
  const towers = (team) => w.units.filter(u => u.alive() && u.structure && u.team === team && u.owner >= 2).length;
  console.log(`round ${n} ended t=${w.time.toFixed(0)}s castles ${c.map(x => x ? Math.round(x.hp) + '/' + Math.round(x.maxHp()) : 'dead').join(' vs ')} ` +
    `towers ${towers(0)} vs ${towers(1)} gold ${w.players.filter(p => p.playing && p.id >= 2).map(p => p.gold).join(',')}`);
});
let lastPhase = '';
const fightLog = {};
while (!w.over && w.time < maxMin * 60) {
  w.step();
  if (r.phase !== lastPhase) { lastPhase = r.phase; }
  if (r.phase === 'fight' && !fightLog[r.round]) {
    fightLog[r.round] = true;
    const sum = (team) => {
      const us = w.units.filter(u => u.alive() && !u.structure && u.owner === team);
      return `${us.length} units hp=${Math.round(us.reduce((a, u) => a + u.hp, 0))} dmg=${us.reduce((a, u) => a + u.baseDmg, 0)} arm=${us.reduce((a, u) => a + u.baseArmor, 0)} types=${[...new Set(us.map(u => u.typeId))].join('/')}`;
    };
    console.log(`  fight r${r.round} t=${w.time.toFixed(0)}: T1 ${sum(0)} | T2 ${sum(1)}`);
  }
}
console.log('result', w.over, 'sim time', w.time.toFixed(0), 'real ms', Date.now() - t0);
const msgs = w.messages.slice(-8).map(m => m.text);
console.log(msgs.join('\n'));
