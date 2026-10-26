const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file:///home/claude/game/index.html');
  await p.waitForSelector('#lobby:not(.hidden)', { timeout: 60000 });
  await p.screenshot({ path: SP + 'l_lobby.png' });
  await p.click('#lb-start');
  await p.waitForFunction(() => window.PyroGame && window.PyroGame.inGame, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  const btn = await p.$('#card .cbtn'); if (btn) await btn.hover(); await p.waitForTimeout(300);
  await p.screenshot({ path: SP + 'l_dialog.png' });
  await p.keyboard.press('F10'); await p.waitForTimeout(300);
  await p.screenshot({ path: SP + 'l_menu.png' });
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
