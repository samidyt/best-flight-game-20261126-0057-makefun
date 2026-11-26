# Skyline Courier

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/samidyt/best-flight-game-20261126-0057-makefun/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/samidyt/best-flight-game-20261126-0057-makefun/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

A complete, original flight game for the [make.fun](https://make.fun/bounty/best-flight-game-20261126-0057)
**"Make the best flight game"** bounty. You are the courier pilot of a
little red aeroplane over a patchwork valley: take off from the Home Strip,
thread the glowing rings over fields, river and road, and put her down
gently on the strip — before the fuel or the clock runs out.

## The sorties

1. **First Solo** (dawn) — 5 rings over the home valley, land back home.
2. **Island Hop** (noon) — 8 rings across the river and the fields, land on
   the Far Strip. Fuel is the boss here.
3. **Storm Run** (dusk) — 10 rings in gusting evening air and rain, land
   home before the light goes.

Each landing is scored: rings, a smooth-landing bonus, and a time bonus.
Stars (1–3) and best scores are saved in your browser; finishing a sortie
unlocks the next.

## Play it

Serve `game/` with any static server and open it in desktop Chrome:

```sh
node serve.ts
# game/ is on http://localhost:8080
```

No build step, no network requests, no assets to download — everything is
drawn on canvas and every sound is synthesised with WebAudio.

## Controls

- **Arrow keys** — pitch and bank (the stick)
- **W / S** or **Shift / Ctrl** — throttle up / down
- **Mouse drag** — steer with the stick; **click** — menus and buttons
- **P / Esc** — pause · **M** — mute · **R** — restart the sortie
- **1–3** — pick a sortie on the title screen

## Flying notes

- Rotate at about 50 kt; below 43 kt the wing stalls and the nose drops.
- A landing counts only on a runway, slow and gentle — hit the ground hard
  and the airframe takes damage; at 100% damage the sortie is over.
- The gold arrow at the top of the screen points at the next ring when it
  is out of view, with the distance in metres.
- The HUD shows airspeed, altitude above the ground, heading, vertical
  speed, throttle, fuel and damage — the instruments are lit, so fly by
  them, not by feel.

## Layout

- `main.ts` — the hand-in program (Node 22): copies `game/` and
  `screenshots/` to `/output` and writes `dossier.json`.
- `game/` — the game, plain static files: `index.html` and `src/`
  (`config`, `random`, `terrain`, `physics`, `world`, `render`, `input`,
  `audio`, `shots`, `main`). No libraries, no network.
- `screenshots/` — 4 real renders of the game's own code, staged by
  `?shot=` scenes in `game/src/shots.js` (see `shots.json`).
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.
- `serve.ts` — a tiny static server for local play.
