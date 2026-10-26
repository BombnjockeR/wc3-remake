const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file:///home/claude/game/dist/PyroTD.html');
  await p.waitForTimeout(800);
  await p.selectOption('#perTeam', '1'); await p.selectOption('#team', '1');
  await p.click('#start');
  for (const i of [0, 0, 1]) { await p.waitForSelector('#dialog .dbtn'); await (await p.$$('#dialog .dbtn'))[i].click(); await p.waitForTimeout(200); }
  const out = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
  const screenOf = (x, y) => p.evaluate(([x, y]) => { const G = window.PyroGame; const c = document.querySelector('#view'); const r = c.getBoundingClientRect();
    return { x: (x - G.cam.x) * G.cam.zoom + c.width / 2 + r.left, y: (G.cam.y - y) * G.cam.zoom + c.height / 2 + r.top }; }, [x, y]);
  // find a valid spot near the south maze with the AI helper, then place through the real UI
  const spot = await p.evaluate(() => { const G = window.PyroGame; G.world.players[G.me].gold = 2000; const s = G.ai.bestSpot(G.me, 'h000'); G.cam.x = s.x; G.cam.y = s.y; G.cam.zoom = 0.22; return s; });
  await p.waitForTimeout(100);
  await p.click('#build button[data-unit="h000"]');
  let s = await screenOf(spot.x, spot.y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(400);
  const spot2 = await p.evaluate(() => { const G = window.PyroGame; return G.ai.bestSpot(G.me, 'h00G'); });
  await p.click('#build button[data-unit="h00G"]');
  s = await screenOf(spot2.x, spot2.y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(3000);
  // select the priest and upgrade it through the panel
  s = await screenOf(spot.x, spot.y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(300);
  const g0 = await p.evaluate(() => window.PyroGame.world.players[window.PyroGame.me].gold);
  await p.click('#panel button.act >> nth=0'); await p.waitForTimeout(300);
  const g1 = await p.evaluate(() => window.PyroGame.world.players[window.PyroGame.me].gold);
  await p.screenshot({ path: out + 'u_upgrading.png' });
  await p.click('#panel button.sell'); await p.waitForTimeout(300); // cancel upgrade
  const g2 = await p.evaluate(() => window.PyroGame.world.players[window.PyroGame.me].gold);
  // evolution tower -> Captain-Evolution, then buy crit twice
  s = await screenOf(spot2.x, spot2.y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(300);
  const names = await p.$$eval('#panel button.act', bs => bs.map(b => b.textContent));
  const capIdx = names.findIndex(n => n.includes('Captain-Evolution'));
  await (await p.$$('#panel button.act'))[capIdx].click(); await p.waitForTimeout(2600);
  await p.mouse.click(s.x, s.y); await p.waitForTimeout(300);
  const names2 = await p.$$eval('#panel button.act', bs => bs.map(b => b.textContent));
  const critIdx = names2.findIndex(n => n.includes('Critical Strike'));
  await (await p.$$('#panel button.act'))[critIdx].click(); await p.waitForTimeout(300);
  await (await p.$$('#panel button.act'))[critIdx].click(); await p.waitForTimeout(300);
  const lvl = await p.evaluate(() => { const G = window.PyroGame; return G.world.byId.get(G.sel).abil.A00B; });
  await p.screenshot({ path: out + 'u_captain_panel.png' });
  // race vote dialog
  await p.evaluate(() => window.PyroGame.rules.startRaceVote());
  await p.waitForTimeout(400);
  await p.screenshot({ path: out + 'u_race.png' });
  await (await p.$$('#dialog .dbtn'))[1].click(); await p.waitForTimeout(400);
  const race = await p.evaluate(() => window.PyroGame.rules.race);
  console.log(JSON.stringify({ g0, g1, g2, upgradeCost: g0 - g1, refunded: g2 - g1, captainCritLevel: lvl, race, names2 }));
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
