# Pyro TD 0.31 — web remake (test build)

A browser version of the Warcraft III map **Pyro TD 0.31** (by Rave, edited by Zero9195 & Rave), rebuilt from the
original `.w3x`. Rules, numbers, tower trees, abilities and the map layout come from the map file; models,
textures, terrain, effects, interface art, sounds and music come from Warcraft III 1.26 game files.

> **Private test build.** `assets/` contains files extracted from Blizzard's Warcraft III. Keep this repository
> (and any site serving it) private; for a public version, replace them with your own art.

## Play

* **Online:** open the GitHub Pages site of this repository (Settings → Pages), or any static web server serving this folder.
* **Locally:** `python3 -m http.server 8080` in this folder, then open <http://localhost:8080>.
  (Opening `index.html` directly from disk also works for single player, but browsers block some audio there.)

In the lobby, set each slot to You / Computer / Closed (1v1 up to 4v4, uneven teams allowed) and press **Start Game**.

### Multiplayer with a room code

1. The host presses **Host a room**. A 5-letter code appears; "Closed" slots become "Open".
2. Friends type the code and press **Join**. They land in the open slots (they can switch with "Take").
3. The host presses **Start Game**.

There is no game server: browsers connect directly (WebRTC). PeerJS's free public broker is only used to introduce
the browsers to each other. The simulation is deterministic: the host runs the clock and sends every tick's commands,
every player runs the same simulation, and a state checksum is compared every 50 ticks (a warning appears if a desync
ever happens). If a player leaves, a computer player takes over their slot. Only the host can pause or change speed.
Some strict networks (symmetric NAT) block direct connections; then try another network or a phone hotspot.
To use your own broker: `npx peerjs --port 9000` and open the game with `?peer=yourhost:9000/peerjs`.

### Controls (like Warcraft III)

| | |
|---|---|
| Left-click | select a unit or tower |
| Right-click | move the selected builder (also on the minimap) |
| Command card | click, or press the hotkey shown in the corner (e.g. **B** Build → **Q** Priest) |
| Shift + click when placing | queue more towers of the same type |
| Esc / right-click | cancel targeting or building |
| Arrow keys, screen edge, middle-drag | move the camera |
| Mouse wheel / `-zoom 2500` | camera distance |
| Minimap | click or drag to look somewhere; buttons: ping, jump home, model labels, sound |
| F1 / Space | select your builder / jump to your base |
| Enter | chat (all players see it). Commands: `-unstuck`, `-zoom X` |
| F9 / F10 / F11 / F12 | Quests, Menu (pause, grid, volumes), Allies, Message log |
| Test speed (top left) | pause, 1×–8× (host only in multiplayer) |

**Build grid.** Towers snap to the terrain tiles (one tower = one 128×128 tile); while placing you see the tile grid,
the tower's 4×4 pathing cells (green / red / yellow), the tower ghost and its range. *Menu → Build grid → Fine*
switches to Warcraft's 32-unit snapping.

## What is recreated

* **Models & animation:** every unit, tower, castle, missile and effect uses its Warcraft model: skeletal animation,
  sequences (stand variations, walk speed matched to movement, attack scaled to cooldown, birth during construction,
  death and decay), team colour and team glow, layer blend modes, texture animation, geoset colour, billboards,
  particle emitters, ribbons, portrait models with their cameras, model sound events.
* **Terrain:** Sunken Ruins tiles with Warcraft's corner blending and variations, city cliff models bent to the ground
  heights, trees (Lordaeron summer), the map's doodads (braziers burn, shrubs, rocks, statues), day/night lighting from
  `DNCLordaeron`, building ground splats, unit shadows, selection circles.
* **Effects:** missiles fly with their arc and play their impact animation; spell and trigger effects use the map's
  own choices (Dark Portal on evolution, eight item effects around the castle on Last Hope, race change effects,
  the fire the map keeps burning in the middle), buff effects (divine shield, frost, stun, bloodlust, spirit link,
  auras), burning buildings, chain lightning from `LightningData.slk`.
* **Interface:** the human console textures, Friz Quadrata font, Warcraft cursor, tooltips and menu frames, info-card
  icons, resource icons, day/night indicator.
* **Sound:** model sound events (attacks, deaths, missiles, spells), melee impact sounds by weapon and armour type,
  acknowledgement sounds, interface sounds, Human music and victory/defeat music.

## Project layout

| Path | What it is |
|---|---|
| `src/gamedata.js` | Data extracted from the map (units, abilities, upgrades, damage table, terrain, regions). Generated. |
| `src/engine.js` | Deterministic Warcraft-like simulation (units, attacks, armour, auras, buffs, movement, pathing). |
| `src/rules.js` | **The game rules**: a port of the map's triggers (each section names the trigger). Edit this to change gameplay. |
| `src/ai.js` | Computer players (new code — the original bots were empty). |
| `src3d/assets.js` | Asset store (packs of game files, image decoding). |
| `src3d/mdx.js` | Warcraft III MDX renderer (animation, particles, ribbons, events, lights). |
| `src3d/terrain.js` | Terrain, cliffs, trees and doodads. |
| `src3d/view.js` | 3D world: units, missiles, effects, decals, placement grid, portrait, picking. |
| `src3d/console.js` | Warcraft III interface, lobby, input, main loop. |
| `src3d/net.js` | Room-code multiplayer (lockstep over WebRTC). |
| `src3d/sound.js` | Sounds and music. |
| `assets/` | Packed game files (`wc3-*.js`, `map-0.js`), file tables (`wc3-files.js`), sound table (`sounds.js`), `sound/*.mp3`. |
| `lib/` | three.js r149, MDX/BLP parsers from mdx-m3-viewer, PeerJS (all MIT). |
| `tools/` | Extraction and packing tools (below). |
| `test/` | Headless AI runs and browser tests (Playwright). `test/mp.js` is a two-browser multiplayer test. |

### Rebuilding the assets from your Warcraft III folder

1. `tools/wc3x.py` (Python, reads classic MPQs) extracts models, textures, terrain tables and interface files, following
   every texture a model uses: `python3 tools/wc3x.py get "<Warcraft III folder>" list.txt out/`.
2. `tools/sx.js` (Node + `@wowserhq/stormjs`) extracts sounds (the MPQ audio compression needs StormLib).
3. `node tools/blp2png.js out/ png/` decodes BLP textures (needs `mdx-m3-viewer` and `pngjs`).
4. `python3 tools/make_soundmap.py` builds the sound table; `python3 tools/build_assets.py ...` packs everything into
   `assets/` (textures become WebP). Sounds are converted to MP3 with ffmpeg.

### Changing rules — examples

* Priest heal amounts: `priestHeal` in `rules.js`. Round income: `endOfRound()`. Ability prices: the `BUY` table.
  Evolution stats: the `EVOLVE` table. Tower stats: `gamedata.js` → `units`.

## Differences from the original (so far)

* Computer players are new; the "strong races" vote and Black Dragon (switched off in 0.31) and minigames (removed) are not included.
* No fog of war, trading UI or castle "take control".
* If a team's units have teleported but one is stuck for 25 s, the team counts as ready (the original relied on `-unstuck`).
* Pathfinding and collision are simplified. Ramps are drawn as smooth ground.
