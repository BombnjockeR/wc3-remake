const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + '\n' + e.stack)); p.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver/.test(m.text()))) errs.push(m.type() + ': ' + m.text()); });
  await p.goto('file:///home/claude/game/index.html?autostart');
  await p.waitForFunction(() => window.PyroGame && window.PyroGame.inGame, null, { timeout: 60000 });
  // vote via the dialog buttons
  for (let i = 0; i < 6; i++) { try { await p.waitForSelector('#dialog .dbtn', { timeout: 4000 }); } catch (e) { break; } await p.click('#dialog .dbtn'); await p.waitForTimeout(400); }
  // find a buildable spot near the start of my maze and centre the camera on it
  const spot = await p.evaluate(() => {
    const G = PyroGame, r = G.rules; const a = r.teamArea(G.me); const st = PyroGame.world.regions.gr1_wp1;
    let best = null, bd = 1e9;
    for (let y = a[1] + 64; y < a[3] - 64; y += 128) for (let x = a[0] + 64; x < a[2] - 64; x += 128) {
      const sx = Math.floor(x / 128) * 128 + 64, sy = Math.floor(y / 128) * 128 + 64;
      if (!r.canBuildAt(G.me, 'h000', sx, sy)) continue; const d = Math.hypot(sx - (st[0] + st[2]) / 2, sy - (st[1] + st[3]) / 2); if (d < bd) { bd = d; best = { x: sx, y: sy }; }
    }
    G.view.cam.x = best.x; G.view.cam.y = best.y; G.camDist = G.view.cam.dist = 1800; return best;
  });
  console.log('spot', JSON.stringify(spot));
  await p.waitForTimeout(300);
  await p.keyboard.press('b'); await p.waitForTimeout(150);
  await p.screenshot({ path: SP + 'u_buildmenu.png' });
  await p.keyboard.press('q'); await p.waitForTimeout(150);
  const s = await p.evaluate((sp) => { const v = PyroGame.view.project(sp.x + 20, sp.y - 10, PyroTerrain.heightAt(sp.x, sp.y)); return v; }, spot);
  await p.mouse.move(s.x, s.y); await p.waitForTimeout(600);
  await p.screenshot({ path: SP + 'u_place.png' });
  // hover a tooltip on the command card
  await p.mouse.click(s.x, s.y); await p.waitForTimeout(300);
  console.log('queue', await p.evaluate(() => JSON.stringify(PyroGame.rules.builders[PyroGame.me].buildQueue)));
  await p.waitForFunction(() => PyroGame.world.units.some(u => u.owner === PyroGame.me && u.typeId === 'h000'), null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  // select the tower
  const t = await p.evaluate(() => { const u = PyroGame.world.units.find(u => u.owner === PyroGame.me && u.typeId === 'h000'); const v = PyroGame.view.project(u.x, u.y, PyroTerrain.heightAt(u.x, u.y) + 60); return v; });
  await p.mouse.click(t.x, t.y); await p.waitForTimeout(400);
  const btn = await p.$('#card .cbtn'); if (btn) await btn.hover(); await p.waitForTimeout(200);
  await p.screenshot({ path: SP + 'u_tower.png' });
  await p.evaluate(() => { PyroGame.speed = 8; });
  await p.waitForFunction(() => PyroGame.rules.phase === 'maze' && PyroGame.world.units.filter(u => u.flags.maze != null).length > 5, null, { timeout: 300000, polling: 300 });
  await p.evaluate(() => { PyroGame.speed = 1; const u = PyroGame.world.units.find(u => u.flags.maze === 0 && u.alive()); PyroGame.view.cam.x = u.x; PyroGame.view.cam.y = u.y; PyroGame.sel = u.id; });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: SP + 'u_maze.png' });
  await p.evaluate(() => { PyroGame.speed = 8; });
  await p.waitForFunction(() => PyroGame.rules.phase === 'fight', null, { timeout: 300000, polling: 300 });
  await p.evaluate(() => { PyroGame.speed = 1; PyroGame.view.cam.x = 0; PyroGame.view.cam.y = -100; PyroGame.sel = null; });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: SP + 'u_fight.png' });
  console.log(await p.evaluate(() => JSON.stringify({ t: PyroGame.world.time, round: PyroGame.rules.round, phase: PyroGame.rules.phase })));
  console.log(errs.slice(0, 15).join('\n') || 'no errors');
  await b.close();
})();
