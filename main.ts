// Skyline Courier — the hand-in program (Node 22, standard library only).
// It copies this repository's game/ and screenshots/ to /output and writes
// /output/dossier.json with the vendored make.fun library, exactly as the
// kit's starter does. Outside the grader's container, MAKEFUN_OUTPUT_DIR
// stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The program is deterministic: it copies files and builds the dossier from
// them, so two runs over the same repository write the same bytes.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Handing in a game without its entrypoint would pass the gate's file checks
// and fail in front of the judge, so refuse loudly instead.
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error('game/index.html is missing: nothing to hand in');
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (from the kit's RULES.txt): only text_max_bytes shapes
// the bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all, or a path under game/ over 1000 bytes).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// One short line for the log, so a run's output names what it handed in.
const shots = existsSync(join(out, 'screenshots')) ? readdirSync(join(out, 'screenshots')).filter((f) => !f.startsWith('.')) : [];
console.log(`handed in game/ + ${shots.length} screenshot(s) + dossier.json to ${out}`);
