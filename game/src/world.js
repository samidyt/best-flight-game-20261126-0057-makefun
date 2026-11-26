// A sortie: one mission flown from takeoff to landing, with rings, fuel,
// damage, wind, timer and score. The world owns the rules; the renderer
// only paints what the world says.
import { FLIGHT, MISSIONS, RING_RADIUS, RUNWAYS, STEP } from './config.js';
import { clamp, lerp, noise2 } from './random.js';
import { createPlane, stepPlane } from './physics.js';
import { heightAt } from './terrain.js';

export const EVENT_RING = 1;
export const EVENT_LANDED = 2;
export const EVENT_CRASH = 4;
export const EVENT_FUEL_EMPTY = 8;
export const EVENT_TIMEOUT = 16;
export const EVENT_TOUCHDOWN = 32;

export function createWorld(missionIndex) {
  const mission = MISSIONS[missionIndex];
  const world = {
    missionIndex,
    mission,
    plane: createPlane(mission.start),
    rings: mission.rings.map((r) => ({ ...r, passed: false, flash: 0 })),
    ringIndex: 0,
    score: 0,
    timeLeft: mission.timeLimit,
    elapsed: 0,
    state: 'ready', // ready | flying | landed | crashed | timeout | fuelout
    message: '',
    messageUntil: 0,
    landBonus: 0,
    smoothLanding: false,
    wind: { x: 0, z: 0 },
    gustPhase: 0,
    events: 0,
    best: 0,
    hasFlown: false,
    fuelWarned: false,
    nagUntil: 0,
  };
  world.plane.fuel = mission.fuel;
  return world;
}

export function nextRing(world) {
  return world.rings[world.ringIndex] ?? null;
}

// Gusts: smooth noise over time, scaled by the mission's wind.
export function currentWind(world, t) {
  const w = world.mission.wind;
  if (w === 0) return { x: 0, z: 0 };
  const gx = (noise2(t * 0.11, 3.7, 1, world.mission.seed) - 0.5) * 2;
  const gz = (noise2(t * 0.09, 9.1, 1, world.mission.seed + 2) - 0.5) * 2;
  return { x: gx * 9 * w, z: gz * 9 * w };
}

function say(world, text, seconds) {
  world.message = text;
  world.messageUntil = world.elapsed + seconds;
}

function ringScore(world) {
  return 100;
}

function landingBonus(world) {
  const p = world.plane;
  const smooth = -p.vy < 3 && p.speed < 32;
  const timeBonus = Math.max(0, Math.floor(world.timeLeft)) * 2;
  return { points: 250 + timeBonus + (smooth ? 150 : 0), smooth, timeBonus };
}

// Is the aircraft over the destination runway, slow and gentle?
function checkLanding(world) {
  const p = world.plane;
  if (p.airborne) return false;
  const r = RUNWAYS[world.mission.landAt];
  if (Math.abs(p.x - r.x) > r.width / 2 - 3) return false;
  if (p.z < r.z0 || p.z > r.z1) return false;
  if (p.speed > 42) return false;
  if (-p.vy > 5) return false;
  return true;
}

// One fixed step of the sortie. Returns an event bitmask.
export function stepWorld(world, input, dt) {
  world.events = 0;
  if (world.state !== 'flying') return 0;
  world.elapsed += dt;
  world.timeLeft -= dt;
  world.gustPhase += dt;

  const p = world.plane;
  world.wind = currentWind(world, world.elapsed);
  const beforeY = p.y;
  stepPlane(p, input, dt, world.wind, world.mission.seed);
  if (p.airborne) world.hasFlown = true;

  // Ring flashes fade.
  for (const ring of world.rings) ring.flash = Math.max(0, ring.flash - dt * 2);

  // Fly through the next ring: within its sphere, roughly on course.
  const ring = nextRing(world);
  if (ring) {
    const dx = p.x - ring.x;
    const dy = p.y - ring.y;
    const dz = p.z - ring.z;
    if (dx * dx + dy * dy + dz * dz < RING_RADIUS * RING_RADIUS) {
      ring.passed = true;
      ring.flash = 1;
      world.ringIndex += 1;
      const gained = ringScore(world);
      world.score += gained;
      world.events |= EVENT_RING;
      const left = world.rings.length - world.ringIndex;
      say(world, left === 0 ? `Last ring! Bring her home to the ${RUNWAYS[world.mission.landAt].name}.` : `Ring ${world.ringIndex} of ${world.rings.length} — +${gained} pts`, 3);
    }
  }

  // Touchdown: a gentle arrival on the destination strip ends the sortie.
  if (!p.airborne && p.y <= heightAt(p.x, p.z, world.mission.seed) + 1.3 && p.speed < 42 && beforeY > p.y + 0.2) {
    world.events |= EVENT_TOUCHDOWN;
  }
  if (checkLanding(world) && world.ringIndex >= world.rings.length) {
    const bonus = landingBonus(world);
    world.landBonus = bonus.points;
    world.smoothLanding = bonus.smooth;
    world.score += bonus.points;
    world.state = 'landed';
    world.events |= EVENT_LANDED;
    say(world, bonus.smooth ? 'Silk-smooth landing!' : 'Down safe.', 5);
    return world.events;
  }
  if (checkLanding(world) && world.ringIndex < world.rings.length && world.hasFlown && world.elapsed > world.nagUntil) {
    say(world, `Not yet — ${world.rings.length - world.ringIndex} ring(s) still to fly.`, 2.5);
    world.nagUntil = world.elapsed + 6;
  }

  // Crash: the airframe gave out, or the ground hit too hard.
  if (p.damage >= 100) {
    world.state = 'crashed';
    world.events |= EVENT_CRASH;
    say(world, 'The airframe gave out.', 5);
    return world.events;
  }

  // Out of fuel: the engine quits; a glide to any flat ground is the only hope.
  if (p.fuel <= 0 && world.state === 'flying') {
    if (!world.fuelWarned) {
      say(world, 'Fuel empty — glide her down!', 4);
      world.fuelWarned = true;
    }
    world.events |= EVENT_FUEL_EMPTY;
    if (!p.airborne && p.speed < 6) {
      world.state = 'fuelout';
      return world.events;
    }
  }

  // The clock ran out mid-air.
  if (world.timeLeft <= 0) {
    world.timeLeft = 0;
    world.state = 'timeout';
    world.events |= EVENT_TIMEOUT;
    say(world, 'Out of time.', 5);
    return world.events;
  }

  return world.events;
}

export function startSortie(world) {
  world.state = 'flying';
  world.elapsed = 0;
  say(world, `${world.mission.name} — throttle up and rotate!`, 4);
}

// Stars by score: 1 for finishing, 2 for a good run, 3 for a great one.
export function starsFor(world) {
  if (world.state !== 'landed') return 0;
  const max = world.rings.length * 100 + 250 + 150 + world.mission.timeLimit * 2;
  const ratio = world.score / max;
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.6) return 2;
  return 1;
}

export { STEP, clamp, lerp };
