// Two-player room-code test against a local PeerJS server (node peertest/server.js) and http.server on :8080
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-claude/2ce7c3de-3e10-5b03-b074-f4515fe8059e/scratchpad/';
const URL = 'http://127.0.0.1:8080/index.html?peer=127.0.0.1:9000/myapp';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const mk = async (tag) => { const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); p.on('pageerror', e => console.log(tag, 'PAGEERROR', e.message)); p.on('console', m => { if (m.type() === 'error') console.log(tag, 'console', m.text()); }); await p.goto(URL); await p.waitForSelector('#lobby:not(.hidden)', { timeout: 90000 }); return p; };
  const host = await mk('HOST'), cli = await mk('CLIENT');
  await host.fill('#lb-name', 'Alice'); await host.click('#lb-host');
  await host.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector('#lb-code').textContent), null, { timeout: 30000 });
  const code = await host.textContent('#lb-code'); console.log('room code', code);
  await cli.fill('#lb-name', 'Bob'); await cli.fill('#lb-joincode', code); await cli.click('#lb-join');
  await host.waitForFunction(() => PyroNet.lobby.slots.some(s => s.name === 'Bob'), null, { timeout: 30000 });
  console.log('host lobby', JSON.stringify(await host.evaluate(() => PyroNet.lobby.slots.map(s => s.id + ':' + s.kind + ':' + (s.name || '')))));
  await cli.screenshot({ path: SP + 'mp_lobby_client.png' });
  await host.click('#lb-start');
  await Promise.all([host, cli].map(p => p.waitForFunction(() => window.PyroGame && PyroGame.inGame, null, { timeout: 90000 })));
  console.log('both in game; client me =', await cli.evaluate(() => PyroGame.me), 'host me =', await host.evaluate(() => PyroGame.me));
  // both vote, client builds a tower through the network
  await host.evaluate(() => { PyroGame.speed = 2; });
  for (const p of [host, cli]) for (let i = 0; i < 3; i++) { try { await p.waitForSelector('#dialog .dbtn', { timeout: 6000 }); await p.click('#dialog .dbtn'); await p.waitForTimeout(300); } catch (e) { break; } }
  const spot = await cli.evaluate(() => { const G = PyroGame, r = G.rules; const a = r.teamArea(G.me);
    for (let y = a[1] + 64; y < a[3] - 64; y += 128) for (let x = a[0] + 64; x < a[2] - 64; x += 128) { const sx = Math.floor(x / 128) * 128 + 64, sy = Math.floor(y / 128) * 128 + 64; if (r.canBuildAt(G.me, 'h000', sx, sy) && Math.abs(sx) < 1500) { G.world.command({ pid: G.me, type: 'build', builder: r.builders[G.me].id, unit: 'h000', x: sx, y: sy }); G.view.cam.x = sx; G.view.cam.y = sy; return { sx, sy }; } } });
  console.log('client build at', JSON.stringify(spot));
  await cli.evaluate(() => PyroGame.world.command({ pid: PyroGame.me, type: 'chat', text: 'hello from Bob' }));
  await host.waitForFunction(() => PyroGame.world.time > 70, null, { timeout: 300000, polling: 500 });
  await cli.waitForFunction(() => PyroGame.world.time > 69, null, { timeout: 120000, polling: 500 });
  const st = async (p) => p.evaluate(() => { const w = PyroGame.world; return { tick: w.tick, hash: PyroNet.stateHash(w), towers: w.units.filter(u => u.typeId === 'h000').map(u => u.owner + '@' + u.x + ',' + u.y), desync: PyroNet.desync, msgs: w.messages.slice(-3).map(m => m.text) }; });
  // compare at the same tick: pause host, let client catch up
  await host.evaluate(() => { PyroGame.world.paused = true; });
  await host.waitForTimeout(1500);
  const h = await st(host), c = await st(cli); console.log('HOST', JSON.stringify(h)); console.log('CLIENT', JSON.stringify(c));
  console.log(h.tick === c.tick && h.hash === c.hash ? 'IN SYNC' : 'MISMATCH');
  await host.screenshot({ path: SP + 'mp_host.png' }); await cli.screenshot({ path: SP + 'mp_client.png' });
  await b.close();
})();
