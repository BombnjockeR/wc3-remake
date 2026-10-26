/* Pyro TD 0.31 rules, ported from the map's trigger script (war3map.j).
 * Each section names the original trigger it comes from, so you can find and change behaviour easily.
 * Numbers (gold, heal amounts, chances...) are the original values unless a comment says otherwise.
 */
(function () {
  'use strict';
  const D = window.PYRO_DATA;
  const { dist, rectCenter, inRect } = window.Pyro;

  // ------------------------------------------------------------------ tower families (Trig_setupvariables)
  const T = {
    priest: ['h000', 'h009', 'h00A', 'h00X', 'h01N', 'h01O', 'h01P'],
    priestHeal: { h000: 1, h009: 4, h00A: 12, h00X: 35, h01N: 70, h01O: 140, h01P: 210 },
    witch: ['h00Y', 'h00Z', 'h01X', 'h04D'],
    witchWard: { h00Y: 'A00O', h00Z: 'A00P', h01X: 'A01R', h04D: 'A05L' },
    frostMage: ['h005', 'h006'], frostWizard: ['h007', 'h008'],
    frostAbil: { h005: 'A004', h006: 'A005', h007: 'A006', h008: 'A007' },
    armorsmith: { h00L: 1, h00M: 3, h00V: 9, h01K: 15, h01L: 30, h01M: 45 },
    armortrainer: { h01A: 1, h04B: 2, h01B: 4, h01T: 8, h01U: 16 },
    weaponsmith: { h002: 1, h00E: 3, h00U: 9, h01H: 15, h01I: 30, h01J: 45 },
    weapontrainer: { h018: 1, h04C: 2, h019: 4, h01R: 8, h01S: 16 },
    chainHealth: { h047: 1, h048: 2, h049: 4 }, chainWeapon: { h044: 1, h045: 2, h046: 4 }, chainArmor: { h041: 1, h042: 2, h043: 4 },
    rulebreaker: { h004: 22, h00R: 22, h00B: 50, h00S: 50, h00D: 150, h00T: 150, h01V: 250, h01W: 250 },
    evolution: ['h00G', 'h00H', 'h00O', 'h01D', 'h03X', 'h01F', 'h02V'],
    goldminer: { h00C: 1, h00F: 5, h00W: 15, h01Q: 30 },
    goldtowers: ['h03S', 'h03R', 'h03Q', 'h034'],
    // goldmine gold per type at end of round (Trig_end_of_the_round), keyed by team-size variant
    goldmine: {
      h032: 2, h033: 6, h03B: 20, h03C: 50, // 4 players
      h03D: 3, h03H: 8, h03K: 25, h03N: 65, // 3 players
      h03E: 4, h03I: 12, h03L: 40, h03O: 100, // 2 players
      h03F: 8, h03J: 24, h03M: 80, h03P: 200, // 1 player
    },
    aura: ['h021', 'h022', 'h023', 'h024', 'h025', 'h026', 'h027', 'h028', 'h04I', 'h04H', 'h04G', 'h04F', 'h04E',
      'h029', 'h02A', 'h02B', 'h02C', 'h02D', 'h02E', 'h02F', 'h02G', 'h02H', 'h02I'],
    yinyang: { h04I: 'S00C', h04H: 'S00D', h04G: 'S00E', h04F: 'S00F', h04E: 'S00G' },
    chaos: ['h01Y', 'h02L'],
    castles: ['h001', 'h011', 'h015', 'h013', 'h017'],
    guardTowers: ['h003', 'h010', 'h014', 'h012', 'h016'],
    fighters: ['hfoo', 'h00I', 'h00N', 'h01E', 'h01G', 'h02W', 'h03Z'],
  };
  // Purchasable abilities on evolution towers: id -> {max level, cost(level) where level = current level}
  const BUY = {
    A00B: { max: 21, cost: l => l === 20 ? 500 : 10 + 20 * l },            // Critical Strike
    A03X: { max: 6, cost: l => -100 + 200 * l },                              // Spirit Link
    A02V: { max: 11, cost: l => -250 + 500 * l },                             // Pulverize
    A030: { max: 7, cost: () => 1500 },                                       // Earthquake
    A02Z: { max: 5, cost: l => 500 + 500 * l },                               // Reincarnation
    A02P: { max: 6, cost: l => 425 + 25 * l },                                // Meteor
    A00C: { max: 11, cost: l => 18 + 2 * l },                                 // Block
    A00L: { max: 3, cost: l => l === 2 ? 1000 : 800 },                        // Multishot
    A013: { max: 7, cost: l => 60 + 10 * l },                                 // Captain-Aura
    A040: { max: 11, cost: l => 175 + 25 * l },                               // Bloodlust
    A014: { max: 6, cost: l => 35 + 5 * l },                                  // Healthpack
    A016: { max: 11, cost: l => 20 + 5 * l },                                 // Eagle Eye
    A019: { max: 19, cost: () => 85 },                                        // Headshot
    A01T: { max: 11, cost: l => 80 + 30 * l },                                // Speed-Aura
    A024: { max: 11, cost: l => 40 + 30 * l },                                // Splash Attack
    A026: { max: 8, cost: l => 90 + 10 * l },                                 // Blizzard
    // Chainlightning: the original checks for (-25 + 50*lvl) gold but charges (-75 + 125*lvl). Kept as-is.
    A029: { max: 11, cost: l => -75 + 125 * l, need: l => -25 + 50 * l },
    A02F: { max: 16, cost: () => 100 },                                       // Fireball
    A02I: { max: 8, cost: l => l < 6 ? 70 + 20 * l : (l === 6 ? 250 : 500) }, // Raiders best Friend
    A02K: { max: 2, cost: () => 250 },                                        // Antimage
  };
  // evolution tower -> {unit, damage bonus, armor bonus, replace method, abilities to grant}
  const EVOLVE = {
    h00H: { to: 'h00I', dmg: 0, armor: 3, method: 0, grant: { A00B: ['A00E', 'A01P'], A00C: ['A00D', 'A01N'], A013: ['A012'], A014: ['A015', 'A01O'] } },
    h00O: { to: 'h00N', dmg: 0, armor: 0, method: 0, grant: { A00L: ['A00M', 'A01M'], A016: ['A017', 'A01Q'], A019: ['A01A', 'A01L'] } },
    h03X: { to: 'h03Z', method: 3, invulnerable: true, grant: { A03X: ['A03W', 'A03Y'], A040: ['A03Z', 'A041'] } },
    h01D: { to: 'h01E', dmg: 2, armor: 2, method: 0, grant: { A01T: ['S000'], A024: ['A022', 'A023'], A02I: ['A02H', 'A02J'], A02K: ['A02M', 'A02L'] } },
    h01F: { to: 'h01G', dmg: 0, armor: 0, method: 0, grant: { A026: ['A027'], A029: ['A02A'], A02F: ['A02G'], A02P: ['A02Q'] } },
    h02V: { to: 'h02W', dmg: 9, armor: 5, method: 0, grant: { A02V: ['A02U', 'A02X'], A02Z: ['A02W', 'A02Y'], A030: ['A031', 'A033'] } },
  };
  const RACES = {
    naga: { castle: 'h011', tower: 'h010', name: 'Naga', color: '#00ff00' },
    ogre: { castle: 'h013', tower: 'h012', name: 'Ogre', color: '#a0522d' },
    nightelf: { castle: 'h015', tower: 'h014', name: 'Night Elf', color: '#22aa22' },
    vampire: { castle: 'h017', tower: 'h016', name: 'Vampire', color: '#888888' },
  };

  class Rules {
    constructor(world, setup) {
      this.w = world; this.setup = setup;
      this.round = 1; this.goldMode = false; this.chaosAllowed = false; this.trading = false;
      this.teamReady = [false, false]; this.teleCount = [0, 0]; this.spawned = [0, 0];
      this.phase = 'lobby'; this.waveEnd = null; this.waveTitle = ''; this.dialog = null;
      this.amountGoldTowers = {}; this.rb = {}; this.yinyang = new Set();
      this.goldForGoldmines = [0, 0]; this.perRound = null; this.raceVote = null; this.race = [null, null];
      this.antiResBug = false; this.mageTimers = {}; this.endCheck = null; this.firstTele = [null, null];
      this.T = T; this.BUY = BUY; this.EVOLVE = EVOLVE; this.RACES = RACES;
      this.hooks();
    }
    R(name) { return this.w.regions[name]; }
    randIn(r) { return { x: r[0] + this.w.rng.next() * (r[2] - r[0]), y: r[1] + this.w.rng.next() * (r[3] - r[1]) }; }
    humans() { return this.w.players.filter(p => p.playing && p.id >= 2); }
    teamPlayers(team) { return this.w.teamPlayers(team); }
    playingCount() { return this.w.players.filter(p => p.playing).length; } // includes the two castle computers
    castleOf(team) { return this.w.units.find(u => u.alive() && T.castles.includes(u.typeId) && u.team === team); }

    // ================================================================== Trig_init
    start() {
      const w = this.w;
      // CreateAllUnits: castles and guard towers
      const cOwner = [this.teamPlayers(0)[0] || w.players[0], this.teamPlayers(1)[0] || w.players[1]];
      this.castle = [
        w.createUnit('h001', cOwner[0].id, -3008, -64, { size: 8 }),
        w.createUnit('h001', cOwner[1].id, 3008, -64, { size: 8 }),
      ];
      for (const c of this.castle) c.abil.A00N = 1; // Last Hope
      w.createUnit('h003', cOwner[0].id, -2624, 256); w.createUnit('h003', cOwner[0].id, -2624, -320);
      w.createUnit('h003', cOwner[1].id, 2624, 256); w.createUnit('h003', cOwner[1].id, 2624, -320);
      // builders (CreateUnitsForPlayer2..9 in the original)
      const BUILDER_POS = { 2: [-609.9, 3648.3], 3: [-543.8, 3709.3], 4: [-466.7, 3652.1], 5: [-538.8, 3576.4], 6: [286.8, -3722.2], 7: [363.9, -3779.4], 8: [291.8, -3855.1], 9: [220.7, -3783.2] };
      this.builders = {};
      for (const p of w.players) if (p.playing && p.id >= 2) {
        const [bx, by] = BUILDER_POS[p.id]; const b = w.createUnit('u000', p.id, bx, by, { noFootprint: true });
        b.buildQueue = []; this.builders[p.id] = b;
      }
      for (let pid = 2; pid <= 9; pid++) {
        w.players[pid].gold = 20;
        w.setTech(pid, 'Rhme', 1); // towers deal 0 damage
        this.amountGoldTowers[pid] = 0;
        this.rb[pid] = { ai: true, self: null, target: null, timer: null };
      }
      // check_for_uneven_teams: goldtower variant depends on the number of builders in team 1
      const n1 = Math.max(1, Math.min(4, this.teamPlayers(0).length));
      this.goldtowerType = { 1: 'h03S', 2: 'h03R', 3: 'h03Q', 4: 'h034' }[n1];
      w.msg('Pyro TD 0.31 — ' + D.texts.description.replace(/\n+/g, ' '), null, 20);
      this.startVotes();
    }

    // ================================================================== start votes (mode, chaostower, trading)
    startVotes() {
      const seq = [
        { key: 'mode', title: 'Mode', options: ['Standard Mode (PvP)', 'Gold Mode (PvP)'] },
        { key: 'chaos', title: 'Allowing Chaostower', options: ['Allow Chaostower', 'Disable Chaostower'] },
        { key: 'trade', title: 'Allowing Trading', options: ['Allow Trading', 'Disable Trading'] },
      ];
      const runVote = (i) => {
        if (i >= seq.length) { this.waveTimerStart(); return; }
        const v = seq[i];
        this.phase = 'vote';
        this.dialog = { key: v.key, title: v.title, options: v.options, votes: {}, end: this.w.time + 15 };
        const finish = () => {
          if (!this.dialog || this.dialog.key !== v.key) return;
          const counts = v.options.map((_, k) => Object.values(this.dialog.votes).filter(x => x === k).length);
          this.dialog = null;
          this.applyVote(v.key, counts);
          runVote(i + 1);
        };
        this.dialog.finish = finish;
        this.dialog.timer = this.w.after(15, finish);
      };
      runVote(0);
    }
    vote(pid, option) {
      const d = this.dialog; if (!d || !d.key) return;
      d.votes[pid] = option;
      const voters = this.humans().filter(p => p.kind === 'human');
      if (voters.every(p => d.votes[p.id] != null)) { this.w.cancel(d.timer); d.finish(); }
    }
    applyVote(key, c) {
      const w = this.w;
      if (key === 'mode') {
        if (c[0] >= c[1]) w.msg('Standard Mode enabled.');
        else {
          this.goldMode = true;
          const n = this.playingCount();
          const techs = n > 8 ? ['R004', 'R005'] : n > 6 ? ['R00I', 'R00F'] : n > 4 ? ['R00J', 'R00G'] : ['R00K', 'R00H'];
          for (const p of w.players) for (const t of techs) w.setTech(p.id, t, 1);
          w.msg(D.texts.goldMode || 'Gold Mode enabled.');
        }
      } else if (key === 'chaos') {
        this.chaosAllowed = c[0] > c[1];
        w.msg(this.chaosAllowed ? 'Chaostower is allowed.' : 'Chaostower is not allowed.');
      } else if (key === 'trade') {
        this.trading = c[0] > c[1];
        w.msg(this.trading ? 'Trading is allowed!' : 'Trading is not allowed.');
      }
    }

    // ================================================================== wave timer
    waveTimerStart() {
      const w = this.w;
      if (this.goldMode) {
        for (let pid = 2; pid <= 9; pid++) w.players[pid].gold = 80;
        w.every(1, () => { for (let pid = 2; pid <= 9; pid++) if (w.players[pid].playing) w.addGold(pid, 1); }); // Goldmode_gold_per_second
      }
      this.startWaveTimer(30, 'Wave starts in');
    }
    startWaveTimer(sec, title) {
      this.phase = 'build'; this.waveEnd = this.w.time + sec; this.waveTitle = title;
      this.waveTimerHandle = this.w.after(sec, () => this.spawnStart());
    }
    // spawnunitsStart / spawnunits1 / spawnunits2
    spawnStart() {
      const w = this.w; this.phase = 'spawn'; this.waveEnd = null;
      this.spawned = [0, 0]; this.teleCount = [0, 0]; this.firstTele = [null, null];
      const tick = w.every(0.9, () => {
        this.spawnOne(0); this.spawnOne(1);
        if (this.spawned[0] >= 10 && this.spawned[1] >= 10) { w.cancel(tick); this.phase = 'maze'; }
      }, 0.9);
    }
    spawnOne(team) {
      const w = this.w; if (this.spawned[team] >= 10) return;
      // Team 1's maze units are owned by Player(1) so Team 1's towers can "attack" (buff) them, and vice versa.
      const owner = team === 0 ? 1 : 0; const pre = team === 0 ? 'gr1' : 'gr2';
      const c = rectCenter(this.R(pre + '_start'));
      const u = w.createUnit('hfoo', owner, c.x, c.y);
      u.hp = 1; u.userData = team === 0 ? 1 : 11; u.flags.maze = team; u.flags.colorTeam = team;
      this.orderNextSpot(u);
      this.spawned[team]++;
    }
    // go_to_next_spot_manual: userData 1..10 = gr1 wp1..wp9, goal; 11..20 = gr2
    spotFor(ud) {
      if (ud >= 1 && ud <= 9) return this.R('gr1_wp' + ud);
      if (ud === 10) return this.R('gr1_goal');
      if (ud >= 11 && ud <= 19) return this.R('gr2_wp' + (ud - 10));
      if (ud === 20) return this.R('gr2_goal');
      return null;
    }
    orderNextSpot(u) { const r = this.spotFor(u.userData); if (r) { const c = rectCenter(r); this.w.orderMove(u, c.x, c.y); } }

    // ================================================================== event wiring
    hooks() {
      const w = this.w;
      w.on('tick', () => this.onTick());
      w.on('attackStart', (a, t, ev) => this.onAttack(a, t, ev));
      w.on('hit', (a, t, dmg, primary) => this.onHit(a, t, dmg, primary));
      w.on('death', (u, k) => this.onDeath(u, k));
      w.on('upgradeFinish', (n, old) => this.onUpgradeFinish(n, old));
      w.on('constructFinish', (u) => this.onUpgradeFinish(u, null));
      w.on('command', (c) => this.onCommand(c));
      w.on('reincarnateEnd', (u) => this.onReincarnated(u));
      w.on('damaged', (t, src) => this.onDamaged(t, src));
      w.every(3, () => this.yinyangCheck());               // yinyang_buff_check
      w.every(2, () => this.antimageActivate());           // antimage_activate
      w.every(3, () => this.autoAntiStuck());               // auto_anti_stuck_units_middle
      w.every(1, () => this.checkForReady());               // checkforready_new / gr2_checkforready_new
      w.every(1, () => this.shamanAutocast());
    }

    onTick() {
      const w = this.w;
      for (const pid in this.builders) this.builderTick(this.builders[pid]);
      for (const u of w.units) {
        if (!u.alive() || u.flags.maze == null) continue;
        // waypoints (wp1..wp9) and teleport at the goal
        const r = this.spotFor(u.userData); if (!r) continue;
        const pad = 24;
        if (u.x >= r[0] - pad && u.x <= r[2] + pad && u.y >= r[1] - pad && u.y <= r[3] + pad) {
          if (u.userData === 10 || u.userData === 20) this.teleport(u);
          else { u.userData++; this.orderNextSpot(u); }
        } else if (u.order.type === 'idle') this.orderNextSpot(u);
      }
    }

    // ================================================================== builder (walks to the build site, then the tower starts)
    builderTick(b) {
      const w = this.w; if (!b || !b.alive()) return;
      // middle_area_teleport_back: builders can't enter the middle
      if (inRect(this.R('middle_area'), b.x, b.y)) {
        const c = rectCenter(this.R(b.team === 0 ? 'gr1_viewarea' : 'gr2_viewarea')); b.x = c.x; b.y = c.y; b.px = b.x; b.py = b.y; w.orderStop(b); b.buildQueue = [];
      }
      const job = b.buildQueue[0]; if (!job) return;
      const d = Math.hypot(job.x - b.x, job.y - b.y);
      if (d <= 110) {
        b.buildQueue.shift();
        const u = this.cmdBuild(b.owner, job.unit, job.x, job.y);
        if (!u && this.canBuildAt(b.owner, job.unit, job.x, job.y) === false) w.msg('Unable to build there.', [b.owner], 3);
        if (!b.buildQueue.length) w.orderStop(b); else { const n = b.buildQueue[0]; w.orderMove(b, n.x, n.y); }
      } else if (b.order.type !== 'move' || b.order.x !== job.x || b.order.y !== job.y) w.orderMove(b, job.x, job.y);
    }
    // ================================================================== teleport / gr2_teleport
    teleport(u) {
      const w = this.w; const team = u.flags.maze;
      u.removeBuff('frost'); delete u.abil.A04C; u.invulnerable = false;
      u.owner = team === 0 ? 0 : 1; u.flags.maze = null; u.flags.middle = team;
      const p = this.randIn(this.R(team === 0 ? 'gr1_castle_teleport' : 'gr2_castle_teleport'));
      u.x = p.x; u.y = p.y; u.path = null;
      this.teleCount[team]++;
      u.userData = this.teleCount[team] + (team === 0 ? 100 : 110);
      if (this.firstTele[team] == null) this.firstTele[team] = w.time;
      const front = ['h02M', 'hfoo', 'h00I', 'h02W'].includes(u.typeId);
      const mid = u.typeId === 'h01E';
      const back = ['h00N', 'h01G', 'h03Z'].includes(u.typeId);
      const rect = front ? (team === 0 ? 'gr1_frontline_area_middle' : 'gr2_random_frontline_area_middle')
        : mid ? (team === 0 ? 'gr1_middleline_area_middle' : 'gr2_middleline_area_middle')
          : back ? (team === 0 ? 'gr1_backline_area_middle' : 'gr2_backline_area_middle')
            : (team === 0 ? 'gr1_frontline_area_middle' : 'gr2_random_frontline_area_middle');
      const q = this.randIn(this.R(rect)); w.orderMove(u, q.x, q.y);
      this.antiResBug = false; this.endEnabled = true;
      w.effect('teleport', u.x, u.y, 0.8);
    }
    // checkforready_new: when 10 living units stand in a team's middle area the team is ready;
    // when both are ready, everyone attack-moves to the enemy castle.
    checkForReady() {
      const w = this.w;
      for (const team of [0, 1]) {
        if (this.teamReady[team] || this.firstTele[team] == null) continue;
        const area = this.R(team === 0 ? 'gr1_random_area_middle_area2' : 'gr2_random_area_middle_area2');
        const n = w.unitsInRect(area, u => !u.structure).length;
        // Port safety (not in the original): if all 10 have teleported and 25 s passed, count the team as ready
        // so a stuck unit can't freeze the game (the original relied on the "-unstuck" chat command).
        const stuckFallback = this.teleCount[team] >= 10 && w.time - this.firstTele[team] > 25;
        if (n === 10 || stuckFallback) {
          this.teamReady[team] = true;
          if (this.teamReady[0] && this.teamReady[1]) this.goFight();
        }
      }
    }
    goFight() {
      const w = this.w; this.phase = 'fight';
      const g1 = rectCenter(this.R('gr1_unit_8_goal')), g2 = rectCenter(this.R('gr2_unit_8_goal'));
      for (const u of w.units) {
        if (!u.alive() || u.structure || u.flags.middle == null) continue;
        const g = u.owner === 0 ? g1 : g2; w.orderAttackMove(u, g.x, g.y);
      }
      this.fightStart = w.time;
      w.msg('Fight!', null, 3);
    }
    unstuck(pid) { // anti_stuck ("-unstuck")
      const w = this.w;
      for (const u of w.units) {
        if (!u.alive() || u.structure) continue;
        if (u.flags.maze != null) { this.orderNextSpot(u); continue; }
        if (u.flags.middle == null) continue;
        if (this.teamReady[0] && this.teamReady[1]) {
          const g = rectCenter(this.R(u.owner === 0 ? 'gr1_unit_8_goal' : 'gr2_unit_8_goal')); w.orderAttackMove(u, g.x, g.y);
        } else {
          const q = this.randIn(this.R(u.owner === 0 ? 'gr1_frontline_area_middle' : 'gr2_random_frontline_area_middle')); w.orderMove(u, q.x, q.y);
        }
      }
      w.msg(w.players[pid].name + ' used unstuck.');
    }
    autoAntiStuck() {
      const w = this.w; if (!(this.teamReady[0] && this.teamReady[1])) return;
      for (const u of w.units) {
        if (!u.alive() || u.structure || u.flags.middle == null) continue;
        const near = w.unitsInRange(u.x, u.y, 900, x => x.owner !== u.owner && x.alive());
        if (!near.length) {
          const g = rectCenter(this.R(u.owner === 0 ? 'gr1_unit_8_goal' : 'gr2_unit_8_goal'));
          if (u.order.type !== 'amove') w.orderAttackMove(u, g.x, g.y);
        }
      }
    }

    // ================================================================== tower attack effects (EVENT_PLAYER_UNIT_ATTACKED)
    onAttack(a, t, ev) {
      const w = this.w; const id = a.typeId;
      // --- priest / chainhealth (Trig_priest)
      if (T.priestHeal[id] != null || T.chainHealth[id] != null) {
        const heal = T.priestHeal[id] != null ? T.priestHeal[id] : a.userData;
        w.setLife(t, t.hp + heal);
        this.fullHealthCheck(t);
      }
      // --- casino (Trig_Casino_Tower), once per round
      if (id === 'h02L' && a.userData === 1) {
        a.userData = 0;
        const r = w.rng.int(1, 100); let g = 0;
        if (r <= 28) g = 0; else if (r <= 48) g = 10; else if (r <= 64) g = 50; else if (r <= 89) g = 100; else if (r <= 99) g = 200; else g = 500;
        w.addGold(a.owner, g);
        w.msg(g ? `A Casino Tower gave you ${g} Gold${g === 500 ? '!' : '.'}` : 'A Casino Tower gave you nothing.', [a.owner], 3);
        w.effect('gold', a.x, a.y, 1, { text: '+' + g });
      }
      // --- goldminer
      if (T.goldminer[id]) { w.addGold(a.owner, T.goldminer[id]); w.effect('gold', a.x, a.y, 0.8, { text: '+' + T.goldminer[id] }); }
      // --- evolution (Trig_evolution_new): only footmen, once per round per tower
      if (EVOLVE[id] && a.userData === 1 && t.typeId === 'hfoo') { a.userData = 0; this.evolve(a, t); return; }
      // --- rulebreaker
      if (T.rulebreaker[id] != null) this.rulebreaker(a, t);
      // --- weaponsmith / chainweapon
      if (T.weaponsmith[id]) this.attackBuff(t, T.weaponsmith[id]);
      if (T.chainWeapon[id]) this.attackBuff(t, a.chainValue || 1);
      // --- weapontrainer: every unit of the same owner within 350 of the target
      if (T.weapontrainer[id]) for (const x of w.unitsInRange(t.x, t.y, 350, x => x.owner === t.owner && !x.structure)) this.attackBuff(x, T.weapontrainer[id]);
      // --- armorsmith / chainarmor
      if (T.armorsmith[id]) this.armorBuff(t, T.armorsmith[id]);
      if (T.chainArmor[id]) this.armorBuff(t, a.chainValue || 1);
      if (T.armortrainer[id]) for (const x of w.unitsInRange(t.x, t.y, 350, x => x.owner === t.owner && !x.structure)) this.armorBuff(x, T.armortrainer[id]);
      // --- witchdoctor: healing ward at the target for 10 s
      if (T.witchWard[id]) {
        const ward = w.createUnit('o000', a.owner, t.x, t.y, { noFootprint: true });
        ward.abil = { [T.witchWard[id]]: 1 }; ward.timedLife = w.time + 10; ward.invulnerable = true;
      }
      // --- chaostower
      if (id === 'h01Y') this.chaosTower(t);
      // --- frost towers: orb of frost slow (35% move, 25% attack) on the target (wizard: splash area)
      if (T.frostAbil[id]) {
        const ab = D.abilities[T.frostAbil[id]]; const dur = ab.dur[0];
        const area = a.def.weapon === 'msplash' ? a.def.splash[0] : 0;
        const tgts = area ? w.unitsInRange(t.x, t.y, area, x => w.enemy(a.owner, x.owner) && !x.structure && !x.invulnerable) : [t];
        const delay = dist(a, t) / (a.def.missile || 900);
        w.after(delay, () => tgts.forEach(x => x.alive() && x.addBuff({ id: 'frost', dur, move: -D.misc.frostMove, ias: -D.misc.frostAttack })));
      }
      // --- fighter abilities
      if (!a.structure) this.fighterAttack(a, t);
      // --- castle Healthpack check (healthpack trigger)
      this.healthpack(a, t);
    }
    fullHealthCheck(t) { // full HP -> invulnerable + "Full Health Aura" marker, keep walking
      if (t.lifePct() >= 100 && t.flags.maze != null) {
        t.abil.A04C = 1; t.invulnerable = true;
        this.w.effect('full', t.x, t.y, 0.8);
      }
    }
    attackBuff(u, n) { u.baseDmg += n; this.w.effect('buff', u.x, u.y, 0.5, { text: '+' + n + ' dmg', color: '#ff7b54' }); }
    armorBuff(u, n) { u.baseArmor += n; this.w.effect('buff', u.x, u.y, 0.5, { text: '+' + n + ' arm', color: '#7ec8ff' }); }
    chaosTower(t) {
      const w = this.w; const r = w.rng.int(1, 100);
      if (r <= 15) w.setLife(t, t.hp + 100);
      else if (r <= 30) w.setLife(t, t.hp >= 76 ? t.hp - 75 : 1);
      else if (r <= 38) w.setLife(t, 100);
      else if (r <= 58) this.attackBuff(t, 10);
      else if (r <= 68) this.attackBuff(t, 20);
      else if (r <= 73) this.attackBuff(t, 30);
      else if (r <= 74) this.attackBuff(t, 70);
      else if (r <= 89) this.armorBuff(t, 10);
      else if (r <= 94) this.armorBuff(t, 20);
      else if (r <= 95) this.armorBuff(t, 50);
      // note: the chaostower never re-checks full health (same as the original)
    }
    // Trig_rulebreaker + rulebreaker_attack_next_unit
    rulebreaker(a, t) {
      const w = this.w; w.setLife(t, T.rulebreaker[a.typeId]);
      const st = this.rb[a.owner] || (this.rb[a.owner] = { ai: true });
      st.target = t; st.self = a;
      w.cancel(st.timer);
      st.timer = w.after(Math.max(0.05, a.cooldown() - 0.2), () => {
        if (!st.ai || !a.alive()) return;
        const opts = w.unitsInRange(a.x, a.y, a.def.points, x => w.enemy(a.owner, x.owner) && x.hp < (st.target ? st.target.hp : 0) && w.canTarget(a, x));
        const pick = w.rng.pick(opts); if (pick) w.orderAttack(a, pick);
      });
      if (t.lifePct() >= 100) { a.holdAttack = false; this.fullHealthCheck(t); }
    }
    // Trig_evolution_new
    evolve(tower, t) {
      const w = this.w; const e = EVOLVE[tower.typeId];
      const ud = t.userData; const dmg = t.baseDmg; const arm = t.baseArmor; const maze = t.flags.maze; const ct = t.flags.colorTeam;
      w.effect('evolve', t.x, t.y, 1.2);
      const n = w.replaceUnit(t, e.to, e.method);
      n.userData = ud; n.flags.maze = maze; n.flags.colorTeam = ct;
      if (e.method !== 3) { n.baseDmg = dmg + e.dmg; n.baseArmor = arm + e.armor; }
      for (const [src, gives] of Object.entries(e.grant)) {
        const lvl = tower.abil[src] || 0;
        if (lvl > 1) for (const g of gives) n.abil[g] = lvl - 1;
      }
      if (e.to === 'h02M' || e.invulnerable) { n.abil.A04C = 1; n.invulnerable = true; }
      this.orderNextSpot(n);
      w.emit('evolved', n, tower);
    }
    // fighter on-attack abilities (eagle eye, headshot, mage spells, raider, tauren, healthpack)
    fighterAttack(a, t) {
      const w = this.w; if (t.structure) {
        if (a.typeId === 'h01E' && a.abil.A02H) this.feralSpirit(a);
        return;
      }
      // Eagle Eye: damage = level * distance/100, pierce, ignores armor
      if (a.abil.A017) w.damage(a, t, a.abil.A017 * dist(a, t) / 100, 'pierce', 'spell');
      // Headshot: (3 + 2*level)% chance (level 18: 40%) for storm-bolt damage + 2 s stun
      if (a.abil.A01A) {
        const lvl = a.abil.A01A; const chance = lvl !== 18 ? 3 + 2 * lvl : 40;
        if (w.rng.int(1, 100) <= chance) {
          const ab = D.abilities.A018; const L = Math.min(18, lvl) - 1;
          w.damage(a, t, ab.dataa[L], 'spells', 'spell'); t.addBuff({ id: 'stun', dur: ab.dur[L] || 2, stun: true });
          w.effect('crit', t.x, t.y, 0.8, { text: 'HEADSHOT' });
        }
      }
      // Mage spells with per-mage timers (mage_active_spells_new_test)
      if (a.typeId === 'h01G') this.mageSpells(a, t);
      // Raider: Raiders best Friend summon and Antimage targeting
      if (a.typeId === 'h01E') {
        if (a.abil.A02H) this.feralSpirit(a);
        if (a.abil.A02M && t.typeId !== 'h01G') {
          const mages = w.unitsInRange(a.x, a.y, 850, x => x.typeId === 'h01G' && x.owner !== a.owner);
          const m = w.rng.pick(mages); if (m) w.orderAttack(a, m);
        }
      }
      // Tauren: Earthquake (thunder clap + 8 shockwaves), 30 s cooldown
      if (a.typeId === 'h02W' && a.abil.A031) this.earthquake(a);
    }
    onHit(a, t, dmg, primary) {
      const w = this.w;
      // Pulverize (Awar): chance per attack to deal damage in 250 AOE around the Tauren (spell damage)
      if (a.abil && a.abil.A02U && primary) {
        const ab = D.abilities.A02U; const L = a.abil.A02U - 1;
        if (w.rng.next() * 100 < ab.dataa[L]) {
          for (const x of w.unitsInRange(a.x, a.y, ab.datac[L] || 250, x => w.enemy(a.owner, x.owner) && !x.structure)) w.damage(a, x, ab.datab[L], 'spells', 'spell');
          w.effect('stomp', a.x, a.y, 0.6, { r: ab.datac[L] || 250 });
        }
      }
    }
    healthpack(a, t) {
      const lvl = t.abil.A015; if (!lvl) return;
      const cross = (a.owner === 0 && t.owner === 1) || (a.owner === 1 && t.owner === 0);
      const townhall = T.castles.includes(a.typeId);
      if ((townhall || cross) && t.hp < 250) {
        this.w.setLife(t, t.hp + lvl * 100); delete t.abil.A015;
        this.w.effect('heal', t.x, t.y, 1, { text: '+' + lvl * 100 });
      }
    }
    cdReady(u, key, sec) {
      const w = this.w; if ((u.cooldowns[key] || -1e9) > w.time) return false;
      u.cooldowns[key] = w.time + sec; return true;
    }
    mageSpells(a, t) {
      const w = this.w; const A = D.abilities;
      if (a.abil.A027 && this.cdReady(a, 'blizzard', 10)) {   // Blizzard: 3 waves on the target point
        const L = a.abil.A027 - 1; const x = t.x, y = t.y;
        for (let i = 0; i < A.A025.dataa[L]; i++) w.after(0.5 + i * 0.9, () => {
          for (const e of w.unitsInRange(x, y, A.A025.area[L] || 200, e => w.enemy(a.owner, e.owner) && !e.structure)) w.damage(a, e, A.A025.datab[L], 'spells', 'spell');
          w.effect('blizzard', x, y, 0.9, { r: A.A025.area[L] || 200 });
        });
      }
      if (a.abil.A02A && this.cdReady(a, 'chain', 5)) {       // Chain lightning
        const L = a.abil.A02A - 1; let cur = t; const hit = new Set();
        for (let i = 0; i < A.A028.datab[L] && cur; i++) {
          hit.add(cur); const from = i === 0 ? a : [...hit][i - 1];
          w.damage(a, cur, A.A028.dataa[L], 'spells', 'spell');
          w.effect('bolt', from.x, from.y, 0.4, { x2: cur.x, y2: cur.y });
          const next = w.unitsInRange(cur.x, cur.y, A.A028.area[L] || 500, e => w.enemy(a.owner, e.owner) && !hit.has(e) && !e.structure)
            .sort((p, q) => dist(cur, p) - dist(cur, q))[0];
          cur = next;
        }
      }
      if (a.abil.A02G && this.cdReady(a, 'fireball', 7)) {    // Fireball (storm bolt)
        const L = a.abil.A02G - 1; const tt = t;
        w.projectiles.push({ x: a.x, y: a.y, target: tt, speed: 1000, owner: a.owner, kind: 'fire', onHit: () => {
          w.damage(a, tt, A.A02E.dataa[L], 'spells', 'spell'); tt.addBuff({ id: 'stun', dur: A.A02E.dur[L], stun: true });
        } });
      }
      if (a.abil.A02Q && this.cdReady(a, 'meteor', 17)) {     // Meteor (rain of fire, 1 wave)
        const L = a.abil.A02Q - 1; const x = t.x, y = t.y;
        w.after(0.8, () => {
          for (const e of w.unitsInRange(x, y, A.A02O.area[L] || 200, e => w.enemy(a.owner, e.owner) && !e.structure)) w.damage(a, e, A.A02O.datab[L], 'spells', 'spell');
          w.effect('meteor', x, y, 0.8, { r: A.A02O.area[L] || 200 });
        });
      }
    }
    feralSpirit(a) {
      const w = this.w; if (!this.cdReady(a, 'feral', D.abilities.A02H.cool[0] || 120)) return;
      const L = a.abil.A02H - 1; const unit = D.abilities.A02H.unit[L] || 'o004';
      const wolf = w.createUnit(unit, a.owner, a.x + 40, a.y + 40, { noFootprint: true });
      wolf.flags.middle = a.team; wolf.timedLife = w.time + (D.abilities.A02H.dur[L] || 120);
      const g = rectCenter(this.R(a.owner === 0 ? 'gr1_unit_8_goal' : 'gr2_unit_8_goal')); w.orderAttackMove(wolf, g.x, g.y);
      w.effect('summon', wolf.x, wolf.y, 0.8);
    }
    earthquake(a) {
      const w = this.w; if (!this.cdReady(a, 'quake', 30)) return;
      const L = a.abil.A031 - 1; const A = D.abilities;
      for (const e of w.unitsInRange(a.x, a.y, A.A031.area[L] || 300, e => w.enemy(a.owner, e.owner) && !e.structure)) {
        w.damage(a, e, A.A031.dataa[L], 'spells', 'spell');
        e.addBuff({ id: 'quake', dur: A.A031.dur[L] || 5, move: -A.A031.datac[L], ias: -A.A031.datad[L] });
      }
      w.effect('stomp', a.x, a.y, 0.8, { r: A.A031.area[L] || 300 });
      // earthquake_shockwaves: 8 directions, 400 range lines
      const lvl = a.abil.A031; const dmg = A.A032.dataa[Math.min(lvl, 6) - 1];
      for (let k = 0; k < 8; k++) {
        const ang = k * Math.PI / 4; const ex = a.x + Math.cos(ang) * 400, ey = a.y + Math.sin(ang) * 400;
        const hitSet = new Set();
        for (let s = 0; s <= 8; s++) {
          const px = a.x + (ex - a.x) * s / 8, py = a.y + (ey - a.y) * s / 8;
          for (const e of w.unitsInRange(px, py, 150, e => w.enemy(a.owner, e.owner) && !e.structure)) hitSet.add(e);
        }
        for (const e of hitSet) w.damage(a, e, dmg, 'spells', 'spell');
        w.effect('bolt', a.x, a.y, 0.5, { x2: ex, y2: ey, color: '#c8a26a' });
      }
    }
    // antimage_activate + antimage_effect_on_cast + antimage_effect_wears_off
    antimageActivate() {
      const w = this.w;
      for (const u of w.unitsInRect(this.R('middle_area'), u => u.typeId === 'h01E' && u.abil.A02M === 1)) {
        const enemies = w.unitsInRect([u.x - 500, u.y - 500, u.x + 500, u.y + 500], x => w.enemy(u.owner, x.owner));
        if (!enemies.length || !this.cdReady(u, 'antimage', 400)) continue;
        u.addBuff({ id: 'divine', dur: 5, invuln: true });
        u.moveSpeedOverride = 420;
        w.after(5, () => { if (u.alive()) u.moveSpeedOverride = 270; });
        const mages = w.unitsInRange(u.x, u.y, 800, x => x.typeId === 'h01G' && x.owner !== u.owner);
        const m = w.rng.pick(mages); if (m) w.orderAttack(u, m);
      }
    }
    // Shaman: Spirit Link and Bloodlust autocast (the abilities are standard WC3 autocasts in the original)
    shamanAutocast() {
      const w = this.w; const A = D.abilities;
      if (!(this.teamReady[0] && this.teamReady[1])) return;
      for (const s of w.units) {
        if (!s.alive() || s.typeId !== 'h03Z') continue;
        if (s.abil.A03W && this.cdReady(s, 'link', A.A03W.cool[s.abil.A03W - 1] || 50)) {
          const L = s.abil.A03W - 1;
          const mates = w.unitsInRange(s.x, s.y, A.A03W.area[L] || 850, x => x.owner === s.owner && !x.structure)
            .sort((p, q) => dist(s, p) - dist(s, q)).slice(0, A.A03W.datab[L]);
          const link = { mates, factor: A.A03W.dataa[L] };
          for (const m of mates) m.addBuff({ id: 'link', dur: A.A03W.dur[L] || 50, link });
          w.effect('link', s.x, s.y, 1, { r: 120 });
        }
        if (s.abil.A03Z && this.cdReady(s, 'lust', A.A03Z.cool[s.abil.A03Z - 1] || 4)) {
          const L = s.abil.A03Z - 1;
          const c = w.unitsInRange(s.x, s.y, A.A03Z.rng[L] || 1350, x => x.owner === s.owner && x !== s && !x.structure && !x.hasBuff('lust'));
          const pick = c.sort((p, q) => dist(s, p) - dist(s, q))[0];
          if (pick) pick.addBuff({ id: 'lust', dur: A.A03Z.dur[L] || 11, ias: A.A03Z.dataa[L] });
        }
      }
    }
    onReincarnated(u) { // reinkarnation + reinkarnation_hp: HP = level*1000, attack speed aura S007
      const lvl = u.abil.A02W || 1;
      u.abil.S007 = lvl; delete u.abil.A02Y; delete u.abil.A02W;
      u.hp = Math.min(u.maxHp(), lvl * 1000);
    }
    onDamaged() { }

    // ================================================================== yin & yang
    yinyangCheck() {
      const w = this.w; const cats = ['priest', 'witch', 'frostMage', 'frostWizard', 'armorsmith', 'armortrainer', 'weaponsmith', 'weapontrainer',
        'chainHealth', 'chainWeapon', 'chainArmor', 'rulebreaker', 'evolution', 'gold', 'aura', 'chaos'];
      const catOf = (id) => {
        for (const c of cats) {
          const v = c === 'gold' ? null : T[c];
          if (c === 'gold') { if (T.goldminer[id] || T.goldmine[id] || T.goldtowers.includes(id)) return c; continue; }
          if (Array.isArray(v) ? v.includes(id) : v && v[id] != null) return c;
        }
        return null;
      };
      for (const u of w.units) {
        const sid = T.yinyang[u.typeId]; if (!sid || !u.alive()) continue;
        const near = w.unitsInRange(u.x, u.y, 190, x => x.structure && x !== u);
        const set = new Set(near.map(x => catOf(x.typeId)).filter(Boolean));
        u.abil = Object.assign({}, u.abil); for (const k of Object.values(T.yinyang)) delete u.abil[k];
        u.abil[sid] = Math.min(9, set.size + 1);
      }
    }

    // ================================================================== death / end of round / defeat
    onDeath(u, killer) {
      const w = this.w;
      if (T.castles.includes(u.typeId)) { this.defeat(u.team); return; }
      if ((u.owner === 0 || u.owner === 1) && this.endEnabled) this.checkEndOfRound();
    }
    middleEmpty() { return this.w.unitsInRect(this.R('middle_area'), u => !u.structure && u.typeId !== 'o000').length === 0; }
    checkEndOfRound() {
      if (!this.middleEmpty() || this.endCheck) return;
      this.endCheck = this.w.after(2.25, () => {
        this.endCheck = null;
        if (this.middleEmpty() && !this.antiResBug && !this.w.over) { this.antiResBug = true; this.endEnabled = false; this.endOfRound(); }
      });
    }
    endOfRound() {
      const w = this.w;
      this.goldForGoldmines = [0, 0];
      for (const u of w.units) {
        if (!u.alive() || T.goldmine[u.typeId] == null) continue;
        this.goldForGoldmines[u.team] += T.goldmine[u.typeId];
      }
      this.teamReady = [false, false]; this.firstTele = [null, null]; this.teleCount = [0, 0];
      w.msg(`End of the round. Next round starts in 20 seconds.`, null, 12.5);
      const income = (this.round * 15 + 10) * (this.goldMode ? 4 : 1);
      w.msg(`+ ${income} Gold`, null, 12.5);
      for (const team of [0, 1]) {
        if (this.goldForGoldmines[team] > 0) {
          const ps = this.teamPlayers(team).map(p => p.id);
          w.msg(`+ ${this.goldForGoldmines[team]} Gold because of Goldmines.`, ps, 12.5);
          for (const pid of ps) w.addGold(pid, this.goldForGoldmines[team]);
        }
      }
      // evolution / ability / casino towers can act again
      for (const u of w.units) if (u.alive() && (EVOLVE[u.typeId] || u.typeId === 'h02L')) u.userData = 1;
      // chain towers grow every round
      for (const u of w.units) {
        if (!u.alive()) continue;
        const rate = T.chainArmor[u.typeId] || T.chainWeapon[u.typeId] || T.chainHealth[u.typeId];
        if (rate) { u.chainValue = Math.min(200, (u.chainValue || 1) + rate); u.userData = u.chainValue; }
      }
      this.castleBonus();
      this.round++;
      const add = (this.round * 15 - 5) * (this.goldMode ? 4 : 1);
      for (let pid = 2; pid <= 9; pid++) if (w.players[pid].playing) w.addGold(pid, add);
      this.startWaveTimer(20, 'Round ' + this.round);
      if ((this.goldMode && this.round === 7) || (!this.goldMode && this.round === 9)) this.startRaceVote();
      w.emit('roundEnd', this.round - 1);
    }
    // end_of_the_round_boni_castle: castle & tower HP/damage grow every round via techs
    castleBonus() {
      const w = this.w; const n = this.playingCount();
      let hpC, hpT, dmC, dmT, techs, late, gold;
      if (n > 8) { hpC = 200; hpT = 100; dmC = 6; dmT = 4; techs = ['R000', 'R001', 'R00U']; late = ['R002', 'R003']; gold = ['R004', 'R005'];
        if (this.goldMode) { hpC += 250; hpT += 250; dmC += 9; dmT += 6; } if (this.round >= 2) { hpC += 100; hpT += 50; } if (this.round >= 11) { hpC += 600; hpT += 350; dmC += 6; dmT += 4; } }
      else if (n > 6) { hpC = 150; hpT = 75; dmC = 6; dmT = 4; techs = ['R009', 'R00C', 'R00T']; late = ['R00O', 'R00L']; gold = ['R00I', 'R00F'];
        if (this.goldMode) { hpC += 185; hpT += 185; dmC += 6; dmT += 4; } if (this.round >= 2) { hpC += 75; hpT += 40; } if (this.round >= 11) { hpC += 450; hpT += 260; dmC += 6; dmT += 4; } }
      else if (n > 4) { hpC = 100; hpT = 50; dmC = 3; dmT = 2; techs = ['R00A', 'R00D', 'R00S']; late = ['R00P', 'R00M']; gold = ['R00J', 'R00G'];
        if (this.goldMode) { hpC += 125; hpT += 125; dmC += 6; dmT += 4; } if (this.round >= 2) { hpC += 50; hpT += 25; } if (this.round >= 11) { hpC += 300; hpT += 175; dmC += 3; dmT += 2; } }
      else { hpC = 50; hpT = 25; dmC = 3; dmT = 2; techs = ['R00B', 'R00E', 'R00R']; late = ['R00Q', 'R00N']; gold = ['R00K', 'R00H'];
        if (this.goldMode) { hpC += 65; hpT += 65; dmC += 3; dmT += 2; } if (this.round >= 2) { hpC += 25; hpT += 10; } if (this.round >= 11) { hpC += 150; hpT += 90; dmC += 3; dmT += 2; } }
      const inc = (pid, t) => w.setTech(pid, t, (w.players[pid].techs[t] || 0) + 1);
      const per = [{ hpC, hpT, dmC, dmT }, { hpC, hpT, dmC, dmT }];
      for (const team of [0, 1]) {
        if (this.ogre && this.ogre[team]) { per[team].hpC += 50; per[team].hpT += 50; }
      }
      for (const p of w.players) {
        if (this.round >= 11) for (const t of late) inc(p.id, t);
        if (this.ogre && this.ogre[p.team]) inc(p.id, 'R006');
        if (this.goldMode) for (const t of gold) inc(p.id, t);
        for (const t of techs) inc(p.id, t);
      }
      this.perRound = per;
      for (const team of [0, 1]) {
        const v = per[team];
        w.msg(`+ ${v.hpC} Castle HP · + ${v.dmC} Castle Damage · + ${v.hpT} Tower HP · + ${v.dmT} Tower Damage`, this.teamPlayers(team).map(p => p.id), 12.5);
      }
    }
    defeat(team) {
      const w = this.w; if (w.over) return;
      w.over = { loser: team, winner: 1 - team, round: this.round, at: w.time };
      w.msg(team === 0 ? (D.texts.defeatRed || 'Team 1 lost!') : (D.texts.defeatBlue || 'Team 2 lost!'), null, 30);
      w.emit('gameOver', w.over);
    }

    // ================================================================== race vote (start_vote_for_special_buildings)
    startRaceVote() {
      const w = this.w;
      this.raceVote = { votes: {}, end: w.time + 50, done: [false, false] };
      this.raceVote.timer = w.after(50, () => this.finishRaceVote());
      w.msg('Choose your Castle & Tower race!', null, 10);
      w.emit('raceVote');
    }
    voteRace(pid, race) {
      const rv = this.raceVote; if (!rv || rv.votes[pid]) return;
      rv.votes[pid] = race;
      const team = this.w.players[pid].team;
      this.w.msg(`${this.w.players[pid].name} voted for ${RACES[race].name}`, this.teamPlayers(team).map(p => p.id), 15);
      const voters = this.teamPlayers(team);
      if (voters.every(p => rv.votes[p.id])) this.applyRace(team);
      if (rv.done[0] && rv.done[1]) { this.w.cancel(rv.timer); this.raceVote = null; }
    }
    finishRaceVote() {
      const rv = this.raceVote; if (!rv) return;
      for (const team of [0, 1]) if (!rv.done[team]) this.applyRace(team);
      this.raceVote = null;
    }
    applyRace(team) {
      const w = this.w; const rv = this.raceVote; if (!rv || rv.done[team]) return;
      rv.done[team] = true;
      const counts = {}; for (const k of Object.keys(RACES)) counts[k] = 0;
      for (const p of this.teamPlayers(team)) if (rv.votes[p.id]) counts[rv.votes[p.id]]++;
      const max = Math.max(...Object.values(counts));
      const top = Object.keys(counts).filter(k => counts[k] === max);
      const race = top.length === 1 ? top[0] : w.rng.pick(top);
      w.msg(`Your team ${top.length === 1 ? 'chose' : 'randomed'} ${RACES[race].name} as their defenders.`, this.teamPlayers(team).map(p => p.id), 15);
      this.race[team] = race;
      if (race === 'ogre') { this.ogre = this.ogre || [false, false]; this.ogre[team] = true; }
      // tower_changing_to_<race>: the special effect each trigger shows on the replaced buildings
      const fx = { naga: 'Objects\\Spawnmodels\\Naga\\NagaDeath\\NagaDeath.mdl', nightelf: 'Objects\\Spawnmodels\\NightElf\\NECancelDeath\\NECancelDeath.mdl',
        ogre: 'Objects\\Spawnmodels\\Human\\HCancelDeath\\HCancelDeath.mdl', vampire: 'Objects\\Spawnmodels\\Undead\\UCancelDeath\\UCancelDeath.mdl' }[race];
      for (const u of w.units.slice()) {
        if (!u.alive() || u.team !== team) continue;
        if (u.typeId === 'h001') {
          const keep = u.abil.A00N; const n = w.replaceUnit(u, RACES[race].castle, 1);
          if (keep) n.abil.A00N = 1;
          this.castle[team] = n; w.effect('race', n.x, n.y, 1.5, { model: fx });
        } else if (u.typeId === 'h003') { const n = w.replaceUnit(u, RACES[race].tower, 1); w.effect('race', n.x, n.y, 1.2, { model: fx }); }
      }
    }

    // ================================================================== upgrades / construction
    onUpgradeFinish(u, old) {
      const id = u.typeId;
      // evolutionAndAbility_constructed: evolution / ability / casino towers act once per round
      if (EVOLVE[id] || id === 'h02L') u.userData = 1;
      if (id === 'h04I') this.yinyang.add(u.id);
      // chaintower_built: chain value starts at 1, upgrades keep the value
      if (T.chainArmor[id] || T.chainWeapon[id] || T.chainHealth[id]) {
        u.chainValue = old && old.chainValue ? old.chainValue : 1; u.userData = u.chainValue;
      }
      if (old && EVOLVE[old.typeId] && EVOLVE[id]) { /* keeps bought abilities via keepAbil */ }
    }

    // ================================================================== player commands
    onCommand(c) {
      const w = this.w; const p = w.players[c.pid]; if (!p) return;
      if (c.type === 'vote') return this.vote(c.pid, c.option);
      if (c.type === 'raceVote') return this.voteRace(c.pid, c.race);
      if (c.type === 'unstuck') return this.unstuck(c.pid);
      if (c.type === 'focus') return this.focusFire(c.pid, c.target);
      if (c.type === 'chat') { w.msg(`|cff${(window.Pyro.PLAYER_COLORS[c.pid] || '#ffffff').slice(1)}${p.name}|r: ${String(c.text || '').slice(0, 120)}`, null, 10); w.emit('chat', c); return; }
      if (c.type === 'leave') { // a network player left: a computer player takes over their towers and builder
        if (p.kind === 'human') { p.kind = 'ai'; w.msg(`${p.name} has left the game. A computer player takes over.`, null, 8); }
        return;
      }
      if (w.over) return;
      if (c.type === 'build') {
        const b = c.builder != null ? w.byId.get(c.builder) : null;
        if (b && b.owner === c.pid && b.buildQueue) { // queue the job on the builder (shift = add to the queue)
          const av = this.available(c.pid, c.unit); if (!av.ok) { w.msg(av.why, [c.pid], 3); return; }
          const s = this.snap(c.x, c.y);
          if (!this.canBuildAt(c.pid, c.unit, s.x, s.y)) { w.msg('Unable to build there.', [c.pid], 3); return; }
          if (!c.queue) b.buildQueue = [];
          b.buildQueue.push({ unit: c.unit, x: s.x, y: s.y }); return;
        }
        return this.cmdBuild(c.pid, c.unit, c.x, c.y);
      }
      const u = w.byId.get(c.unit);
      if (c.type === 'move' && u && u.owner === c.pid && !u.structure && u.buildQueue) { u.buildQueue = []; w.orderMove(u, c.x, c.y); return; }
      if (c.type === 'stop' && u && u.owner === c.pid && u.buildQueue) { u.buildQueue = []; w.orderStop(u); return; }
      if (c.type === 'skin' && u && u.owner === c.pid && u.buildQueue) {
        const n = w.replaceUnit(u, c.to, 1); n.buildQueue = []; this.builders[c.pid] = n; w.emit('builderChanged', n); return;
      }
      if (c.type === 'lastHope') return this.lastHope(c.pid, u);
      if (!u || !u.alive() || u.owner !== c.pid) return;
      if (c.type === 'upgrade') return this.cmdUpgrade(u, c.to);
      if (c.type === 'sell') return this.cmdSell(u);
      if (c.type === 'cancel') return this.cmdCancel(u);
      if (c.type === 'buy') return this.cmdBuy(u, c.abil);
      if (c.type === 'hold') { u.holdAttack = !u.holdAttack; if (u.holdAttack) u.target = null; return; }
      if (c.type === 'rbai') { const st = this.rb[c.pid]; st.ai = !st.ai; return; }
    }
    focusFire(pid, targetId) {
      const w = this.w; const t = w.byId.get(targetId); if (!t) return;
      for (const u of w.units) if (u.alive() && u.owner === pid && u.structure && w.canTarget(u, t)) w.orderAttack(u, t);
    }
    available(pid, typeId) { // build/upgrade requirements
      const def = D.units[typeId];
      if (T.goldtowers.includes(typeId)) {
        if (typeId !== this.goldtowerType) return { ok: false, why: 'Not available for this team size' };
        if ((this.amountGoldTowers[pid] || 0) >= 5) return { ok: false, why: 'Already built 5 Goldtowers.' };
      }
      if (def.requires.includes('h01Z') && !this.chaosAllowed) return { ok: false, why: 'Chaostower got disabled by vote.' };
      if (this.w.players[pid].gold < def.cost) return { ok: false, why: 'Not enough gold' };
      return { ok: true };
    }
    teamArea(pid) { return this.R(this.w.players[pid].team === 0 ? 'Team_1_Area' : 'Team_2_Area'); }
    snap(x, y) { return { x: Math.round(x / 32) * 32, y: Math.round(y / 32) * 32 }; }
    canBuildAt(pid, typeId, x, y) {
      const w = this.w; const s = this.snap(x, y);
      const area = this.teamArea(pid);
      if (!inRect(area, s.x - 64, s.y - 64) || !inRect(area, s.x + 64, s.y + 64)) return false;
      if (!w.grid.canPlace(s.x, s.y, 4)) return false;
      // can't build on top of units walking the maze
      if (w.units.some(u => u.alive() && !u.structure && !u.flying && Math.abs(u.x - s.x) < 64 + u.collision && Math.abs(u.y - s.y) < 64 + u.collision)) return false;
      if (typeId === 'h004') { // rulebreaker_positioning
        const ok = inRect(this.R('rulebreaker_region'), s.x, s.y) || inRect(this.R('rulebreaker_region_team2'), s.x, s.y);
        if (!ok) return false;
      }
      return true;
    }
    cmdBuild(pid, typeId, x, y) {
      const w = this.w; const builds = D.units.u000.builds;
      if (!builds.includes(typeId)) return false;
      const av = this.available(pid, typeId); if (!av.ok) { w.msg(av.why, [pid], 3); return false; }
      if (!this.canBuildAt(pid, typeId, x, y)) {
        if (typeId === 'h004') w.msg('Rulebreaker can only be positioned at the start of the maze.', [pid], 4);
        return false;
      }
      const s = this.snap(x, y);
      const def = D.units[typeId];
      w.addGold(pid, -def.cost);
      const u = w.createUnit(typeId, pid, s.x, s.y, { size: 4 });
      u.building = { kind: 'construct', until: w.time + def.build };
      u.hp = 1;
      if (T.goldtowers.includes(typeId)) this.amountGoldTowers[pid] = (this.amountGoldTowers[pid] || 0) + 1;
      if (typeId === 'h004') this.rb[pid].self = u;
      return u;
    }
    cmdUpgrade(u, to) {
      const w = this.w; if (u.building) return false;
      if (!u.def.upgradesTo.includes(to)) return false;
      const av = this.available(u.owner, to); if (!av.ok) { w.msg(av.why, [u.owner], 3); return false; }
      w.addGold(u.owner, -D.units[to].cost);
      const keep = {};
      if (EVOLVE[to]) { /* new ability tower starts with level-1 abilities */ }
      u.building = { kind: 'upgrade', to, until: w.time + D.units[to].build, keepAbil: keep };
      u.target = null;
      return true;
    }
    cmdSell(u) { // destroy_tower: refund half of the invested gold (tower max HP = invested gold)
      const w = this.w; if (!u.structure || T.castles.includes(u.typeId) || T.guardTowers.includes(u.typeId)) return;
      const id = u.typeId;
      if (u.building) return this.cmdCancel(u);
      if (T.goldtowers.includes(id) || T.goldminer[id] || T.goldmine[id] != null) this.amountGoldTowers[u.owner] = Math.max(0, (this.amountGoldTowers[u.owner] || 0) - 1);
      const g = Math.floor(u.def.hp / 2);
      w.addGold(u.owner, g);
      w.msg(`You gained ${g} Gold for selling ${u.def.name}`, [u.owner], 4);
      w.removeUnit(u);
    }
    cmdCancel(u) { // WC3 cancel: ConstructionRefundRate / UpgradeRefundRate = 1.0 (full refund)
      const w = this.w; const b = u.building; if (!b) return;
      if (b.kind === 'upgrade') { w.addGold(u.owner, D.units[b.to].cost); u.building = null; return; }
      w.addGold(u.owner, u.def.cost);
      if (T.goldtowers.includes(u.typeId)) this.amountGoldTowers[u.owner] = Math.max(0, (this.amountGoldTowers[u.owner] || 0) - 1);
      w.removeUnit(u);
    }
    cmdBuy(u, abil) { // abilities_purshased
      const w = this.w; const b = BUY[abil]; if (!b || u.abil[abil] == null) return false;
      const lvl = u.abil[abil];
      if (lvl >= b.max) return false;
      const cost = b.cost(lvl); const need = b.need ? b.need(lvl) : cost;
      if (w.players[u.owner].gold < need) { w.msg('Not enough gold', [u.owner], 2); return false; }
      w.addGold(u.owner, -cost);
      u.abil[abil] = lvl + 1;
      return true;
    }
    lastHope(pid, castle) {
      const w = this.w; if (!castle || !castle.alive() || !castle.abil.A00N) return;
      if (!w.ally(pid, castle.owner)) return;
      delete castle.abil.A00N;
      const ab = D.abilities.A00N;
      for (const e of w.unitsInRange(castle.x, castle.y, ab.area[0], e => w.enemy(castle.owner, e.owner) && !e.structure)) {
        w.damage(castle, e, ab.dataa[0], 'spells', 'spell'); e.addBuff({ id: 'stun', dur: 3, stun: true });
      }
      w.effect('lasthope', castle.x, castle.y, 1.5, { r: ab.area[0] });
      w.msg(`${w.players[pid].name} used Last Hope!`);
    }
  }

  window.Pyro.Rules = Rules;
})();
