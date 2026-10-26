# Map extraction tools

These scripts read the original `PyroTD0.31.w3x` and produce `src/gamedata.js`.

1. `mpq.py` — reads the map archive, including the protected/encrypted files (keys are recovered automatically).
2. `objdata.py` — merges the map's unit/ability/upgrade changes with the base Warcraft III data tables
   (from the open-source w3x2lni project, `data/enUS-1.27.1/mpq/Units`).
3. `extract_map.py` — terrain, pathing, doodads and regions.
4. `build_data.py` — writes `src/gamedata.js`.
5. `jsimplify.py` — makes the trigger script (`war3map.j`) easier to read.

Paths inside the scripts point to the folders used when this port was made; adjust them before re-running.
