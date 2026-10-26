const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file:///home/claude/game/index.html');
  await p.waitForTimeout(800);
  await p.selectOption('#perTeam', process.argv[2] || '3');
  await p.fill('#seed', process.argv[3] || '99');
  await p.click('#start');
  for (const i of (process.argv[4]||"1,0,1").split(",").map(Number)) { await p.waitForSelector('#dialog .dbtn'); await (await p.$$('#dialog .dbtn'))[i].click(); await p.waitForTimeout(200); }
  // let the AI play for me too, and keep selecting random things so every panel renders
  await p.evaluate(() => {
    const G = window.PyroGame; G.world.players[G.me].kind = 'ai'; G.speed = 40;
    setInterval(() => {
      const us = G.world.units.filter(u => u.alive()); const u = us[Math.floor(Math.random() * us.length)]; if (u) G.sel = u.id;
      const btns = [...document.querySelectorAll('#panel button:not(:disabled)')]; if (btns.length && Math.random() < 0.3) btns[Math.floor(Math.random() * btns.length)].click();
    }, 400);
  });
  const out = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
  let shots = 0;
  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(2000);
    const st = await p.evaluate(() => { const G = window.PyroGame; const r = G.rules, w = G.world;
      return { round: r.round, phase: r.phase, t: Math.round(w.time), over: w.over, race: r.race, rv: !!r.raceVote,
        types: [...new Set(w.units.filter(u => u.alive() && !u.structure).map(u => u.typeId))].join(','),
        castles: [0, 1].map(t => { const c = r.castleOf(t); return c ? Math.round(c.hp) + '/' + Math.round(c.maxHp()) : 'x'; }) }; });
    if (i % 5 === 0) console.log(JSON.stringify(st));
    if (st.rv && shots < 1) { shots++; await p.evaluate(() => { window.PyroGame.speed = 1; }); await p.waitForTimeout(500); await p.screenshot({ path: out + 'l_race.png' }); await p.evaluate(() => { window.PyroGame.speed = 40; }); }
    if (st.over) { console.log('OVER', JSON.stringify(st)); break; }
  }
  await p.evaluate(() => { const G = window.PyroGame; G.speed = 1; G.cam.x = 0; G.cam.y = 0; G.cam.zoom = 0.12; });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out + 'l_end.png' });
  console.log(errs.slice(0, 10).join('\n') || 'no errors');
  await b.close();
})();
