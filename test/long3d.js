// Long AI run in the browser: checks for errors and grabs screenshots of later rounds (evolutions, races, missiles, effects)
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + e.stack)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file:///home/claude/game/index.html?autostart');
  await p.waitForFunction(() => window.PyroGame && PyroGame.inGame, null, { timeout: 90000 });
  await p.evaluate(() => { PyroGame.speed = 8; const G = PyroGame; G.world.players[G.me].kind = 'ai'; }); // let the AI play my slot too
  for (const [t, name] of [[400, 'L1'], [800, 'L2'], [1200, 'L3']]) {
    await p.waitForFunction((n) => PyroGame.world.time >= n || PyroGame.world.over, t, { timeout: 1500000, polling: 1000 });
    await p.evaluate(() => { const G = PyroGame; G.speed = 1; const fighters = G.world.units.filter(u => u.alive() && !u.structure && u.flags.maze != null);
      const u = fighters.find(u => u.typeId !== 'hfoo') || fighters[0]; if (u) { G.view.cam.x = u.x; G.view.cam.y = u.y; G.sel = u.id; } G.camDist = G.view.cam.dist = 1650; });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: SP + name + '.png' });
    console.log(name, await p.evaluate(() => JSON.stringify({ t: Math.round(PyroGame.world.time), round: PyroGame.rules.round, phase: PyroGame.rules.phase, races: PyroGame.rules.race, units: PyroGame.world.units.length, types: [...new Set(PyroGame.world.units.filter(u => !u.structure).map(u => u.typeId))] })));
    await p.evaluate(() => { PyroGame.speed = 8; });
  }
  console.log(errs.slice(0, 10).join('\n') || 'no errors');
  await b.close();
})();
