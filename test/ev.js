// Usage: node test/ev.js <secs> "<js expr run in page after secs>" [shot-name] [speed]
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
(async () => {
  const secs = +process.argv[2], expr = process.argv[3], shot = process.argv[4], speed = +(process.argv[5] || 1);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack)); p.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver/.test(m.text())) || m.type() === 'log') errs.push(m.type() + ': ' + m.text()); });
  await p.goto(process.env.URL || 'file:///home/claude/game/index.html?autostart');
  await p.waitForFunction(() => window.PyroGame && window.PyroGame.inGame, null, { timeout: 60000 });
  await p.evaluate((s) => { window.PyroGame.speed = s; }, speed);
  if (secs > 0) await p.waitForFunction((n) => window.PyroGame.world.time >= n, secs, { timeout: 900000, polling: 300 });
  const pre = process.env.PRE; if (pre) { await p.evaluate(pre); await p.waitForTimeout(+(process.env.WAIT || 300)); }
  if (expr) console.log(await p.evaluate(expr));
  if (shot) await p.screenshot({ path: SP + shot + '.png' });
  console.log(errs.slice(0, 15).join('\n') || 'no errors');
  await b.close();
})();
