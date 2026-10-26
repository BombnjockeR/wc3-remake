const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 700 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() !== 'log') errs.push(m.type() + ': ' + m.text()); });
  await p.goto('file:///home/claude/game/test/modelview.html');
  await p.waitForTimeout(2500);
  console.log(await p.evaluate(() => info().join('\n')));
  await p.screenshot({ path: '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/models1.png' });
  await p.waitForTimeout(700);
  await p.screenshot({ path: '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/models2.png' });
  console.log(errs.slice(0, 10).join('\n') || 'no errors');
  await b.close();
})();
