const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file:///home/claude/game/index.html');
  await p.waitForTimeout(1500);
  const out = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
  await p.screenshot({ path: out + 's1_lobby.png' });
  await p.click('#start');
  await p.waitForTimeout(800);
  await p.screenshot({ path: out + 's2_start.png' });
  // vote standard, allow chaos, disable trade
  for (const i of [0, 0, 1]) { await p.waitForSelector('#dialog .dbtn'); await (await p.$$('#dialog .dbtn'))[i].click(); await p.waitForTimeout(300); }
  // build some towers via UI clicks: priest near maze
  await p.evaluate(() => { const G = window.PyroGame; G.cam.x = 600; G.cam.y = 3900; G.cam.zoom = 0.2; });
  await p.waitForTimeout(200);
  await p.click('#build button[data-unit="h000"]');
  const pts = await p.evaluate(() => { const G = window.PyroGame; const c = document.querySelector('#view'); const r = c.getBoundingClientRect();
    const toS = (x, y) => ({ x: (x - G.cam.x) * G.cam.zoom + c.width / 2 + r.left, y: (G.cam.y - y) * G.cam.zoom + c.height / 2 + r.top });
    return [toS(800, 4000), toS(800, 3850)]; });
  await p.mouse.move(pts[0].x, pts[0].y); await p.waitForTimeout(100);
  await p.screenshot({ path: out + 's3_placing.png' });
  await p.mouse.click(pts[0].x, pts[0].y);
  await p.waitForTimeout(300);
  await p.click('#build button[data-unit="h000"]');
  await p.mouse.click(pts[1].x, pts[1].y);
  await p.waitForTimeout(500);
  await p.click('#build button[data-unit="h000"]'); await p.keyboard.press('Escape');
  await p.click('[data-speed="4"]');
  await p.waitForTimeout(12000);
  await p.screenshot({ path: out + 's4_maze.png' });
  await p.evaluate(() => { const G = window.PyroGame; G.cam.x = 0; G.cam.y = 0; G.cam.zoom = 0.13; });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: out + 's5_fight.png' });
  const st = await p.evaluate(() => { const G = window.PyroGame; return { round: G.rules.round, phase: G.rules.phase, gold: G.world.players[G.me].gold, t: G.world.time, mine: G.world.units.filter(u => u.owner === G.me && u.alive()).map(u => u.typeId) }; });
  console.log(JSON.stringify(st));
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
