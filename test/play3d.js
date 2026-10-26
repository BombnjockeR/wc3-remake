// Usage: node test/play3d.js [seconds-of-game] [speed] [out-prefix]
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
(async () => {
  const secs = +(process.argv[2] || 5), speed = +(process.argv[3] || 1), pre = process.argv[4] || 'g';
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  await p.goto('file:///home/claude/game/index.html');
  await p.waitForTimeout(800);
  await p.screenshot({ path: SP + pre + '_lobby.png' });
  await p.click('#lb-start');
  await p.waitForTimeout(400);
  await p.screenshot({ path: SP + pre + '_loading.png' });
  await p.waitForFunction(() => window.PyroGame.inGame, null, { timeout: 60000 });
  await p.evaluate((s) => { window.PyroGame.speed = s; }, speed);
  const t0 = Date.now();
  await p.waitForFunction((n) => window.PyroGame.world.time >= n, secs, { timeout: 600000, polling: 500 });
  console.log('sim', secs, 's took', (Date.now() - t0) / 1000, 'real s');
  await p.screenshot({ path: SP + pre + '_game.png' });
  console.log(await p.evaluate(() => { const G = window.PyroGame; return JSON.stringify({ round: G.rules.round, phase: G.rules.phase, units: G.world.units.length, sel: G.sel, fps: 0 }); }));
  console.log(errs.slice(0, 15).join('\n') || 'no errors');
  await b.close();
})();
