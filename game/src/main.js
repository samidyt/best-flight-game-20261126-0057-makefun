// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps, and the renderer paints what is there. The game moves
// between title, briefing, play, paused and the end screens, over three
// sorties that unlock in order.
//
// ?shot=cover|takeoff|title|dusk stages that scene instead of running the
// loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, MISSIONS, PROGRESS_KEY, STEP } from './config.js';
import { createWorld, EVENT_CRASH, EVENT_FUEL_EMPTY, EVENT_LANDED, EVENT_RING, EVENT_TIMEOUT, EVENT_TOUCHDOWN, startSortie, starsFor, stepWorld } from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_BRIEF, SCREEN_CAMPAIGN, SCREEN_CRASHED, SCREEN_FUELOUT, SCREEN_LANDED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TIMEOUT, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const audio = createAudio();

function readSave() {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Storage can be off: the save then lasts this visit only.
  }
  return { scores: [0, 0, 0], stars: [0, 0, 0], progress: 0 };
}

function writeSave(save) {
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(save));
    window.localStorage.setItem(PROGRESS_KEY, String(save.progress));
  } catch {
    // Ignore storage failures.
  }
}

const save = readSave();
let best = save.scores[0] + save.scores[1] + save.scores[2];

function runShot(name) {
  const tParam = Number.parseFloat(params.get('t') ?? '');
  const view = stageShot(name, Number.isFinite(tParam) ? tParam : undefined);
  renderer.setWorld(view.world.mission.seed);
  renderer.resize(window.innerWidth, window.innerHeight);
  let painted = 0;
  function paint() {
    renderer.draw(view, 1.2);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else {
      window.__shotReady = true;
      document.documentElement.setAttribute('data-shot-ready', 'true');
    }
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let selected = 0;
  let world = createWorld(0);
  let starsEarned = 0;
  let totalScore = 0;
  let throttleLever = 0;
  let time = 0;

  renderer.setWorld(world.mission.seed);
  resize();
  window.addEventListener('resize', resize);

  function resize() {
    renderer.resize(window.innerWidth, window.innerHeight);
  }

  function announce(message) {
    status.textContent = message;
  }

  function openTitle() {
    screen = SCREEN_TITLE;
    world = createWorld(selected);
    renderer.setWorld(world.mission.seed);
    announce('Skyline Courier. Choose a sortie.');
  }

  function openBrief() {
    screen = SCREEN_BRIEF;
    world = createWorld(selected);
    renderer.setWorld(world.mission.seed);
    announce(`${world.mission.name}. ${world.mission.brief}`);
  }

  function fly() {
    screen = SCREEN_PLAY;
    world = createWorld(selected);
    renderer.setWorld(world.mission.seed);
    throttleLever = 0;
    startSortie(world);
    audio.resume();
    announce(`Flying ${world.mission.name}.`);
  }

  function endSortie(endScreen) {
    screen = endScreen;
    if (endScreen === SCREEN_LANDED) {
      starsEarned = starsFor(world);
      const i = world.missionIndex;
      if (world.score > save.scores[i]) save.scores[i] = world.score;
      if (starsEarned > save.stars[i]) save.stars[i] = starsEarned;
      if (i < 2 && save.progress < i + 1) save.progress = i + 1;
      totalScore = save.scores[0] + save.scores[1] + save.scores[2];
      if (totalScore > best) best = totalScore;
      writeSave(save);
      audio.thud();
    } else if (endScreen === SCREEN_CRASHED) {
      audio.crash();
    }
    announce(endScreen === SCREEN_LANDED ? `Sortie complete. Score ${world.score}.` : 'Sortie over.');
  }

  function advanceFromEnd() {
    if (screen === SCREEN_LANDED) {
      if (world.missionIndex < 2) {
        selected = world.missionIndex + 1;
        openBrief();
      } else {
        screen = SCREEN_CAMPAIGN;
        totalScore = save.scores[0] + save.scores[1] + save.scores[2];
      }
    } else if (screen === SCREEN_CAMPAIGN) {
      selected = 0;
      openTitle();
    } else {
      openBrief();
    }
  }

  // Mission card geometry, kept in step with the renderer's title screen.
  function cardAt(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cw = Math.min(200, (w * 0.8) / 3 - 16);
    const cx0 = (w - (cw * 3 + 32)) / 2;
    const cy0 = h * 0.36;
    if (y < cy0 || y > cy0 + 150) return -1;
    for (let i = 0; i < 3; i += 1) {
      const x0 = cx0 + i * (cw + 16);
      if (x >= x0 && x <= x0 + cw) return i;
    }
    return -1;
  }

  function handleClick(click) {
    if (!click) return;
    if (screen === SCREEN_TITLE) {
      const i = cardAt(click.x, click.y);
      if (i >= 0 && i <= save.progress) {
        if (selected === i) openBrief();
        else {
          selected = i;
          audio.click();
        }
      }
    } else if (screen === SCREEN_BRIEF || screen === SCREEN_LANDED || screen === SCREEN_CRASHED || screen === SCREEN_TIMEOUT || screen === SCREEN_FUELOUT || screen === SCREEN_CAMPAIGN) {
      if (screen === SCREEN_BRIEF) fly();
      else advanceFromEnd();
      audio.click();
    }
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.muted);
      announce(audio.muted ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_RESTART && (screen === SCREEN_PLAY || screen === SCREEN_PAUSED)) {
      openBrief();
      return;
    }
    if (screen === SCREEN_TITLE) {
      const digit = input.digitPressed();
      if (digit >= 1 && digit <= 3 && digit - 1 <= save.progress) selected = digit - 1;
      if (actions & ACTION_CONFIRM) openBrief();
    } else if (screen === SCREEN_BRIEF) {
      if (actions & ACTION_CONFIRM) fly();
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Flying.');
      }
    } else if (screen === SCREEN_LANDED || screen === SCREEN_CRASHED || screen === SCREEN_TIMEOUT || screen === SCREEN_FUELOUT || screen === SCREEN_CAMPAIGN) {
      if (actions & ACTION_CONFIRM) advanceFromEnd();
    }
    handleClick(input.takeClick());
  }

  let last = performance.now();
  let accumulator = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    time = now / 1000;
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_PLAY) {
      // The throttle lever: W/Shift push it up, S/Ctrl pull it back.
      throttleLever = Math.max(0, Math.min(1, throttleLever + input.throttleNudge() * accumulator * 0.9));
      const stick = input.stick();
      while (accumulator >= STEP) {
        const events = stepWorld(world, { pitch: stick.pitch, roll: stick.roll, throttle: throttleLever }, STEP);
        accumulator -= STEP;
        if (events & EVENT_RING) audio.ring();
        if (events & EVENT_TOUCHDOWN) audio.thud();
        if (events & EVENT_LANDED) endSortie(SCREEN_LANDED);
        else if (events & EVENT_CRASH) endSortie(SCREEN_CRASHED);
        else if (events & EVENT_TIMEOUT) endSortie(SCREEN_TIMEOUT);
        else if (events & EVENT_FUEL_EMPTY && world.state === 'fuelout') endSortie(SCREEN_FUELOUT);
        if (screen !== SCREEN_PLAY) {
          accumulator = 0;
          break;
        }
      }
      audio.update(throttleLever, world.plane.speed, screen === SCREEN_PLAY);
    } else {
      accumulator = 0;
      audio.update(0, 0, false);
    }
    const view = {
      world,
      screen,
      missions: MISSIONS,
      selected,
      progress: save.progress,
      stars: save.stars,
      best,
      starsEarned,
      totalScore,
    };
    // Live state for automation and embeds: the real numbers, every frame.
    canvas.dataset.state = JSON.stringify({
      screen,
      speed: Math.round(world.plane.speed * 10) / 10,
      alt: Math.round(world.plane.y * 10) / 10,
      rings: world.ringIndex,
      score: world.score,
      fuel: Math.round(world.plane.fuel * 100) / 100,
      airborne: world.plane.airborne,
    });
    renderer.draw(view, time);
  }

  // Leaving the tab pauses a running sortie rather than letting it fly unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Skyline Courier. Choose a sortie.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
