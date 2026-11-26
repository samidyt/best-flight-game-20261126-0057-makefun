// The screenshot scenes behind ?shot=cover|takeoff|title|dusk. Each one plays
// the real rules forward from a fresh world for a fixed time, steered by a
// simple autopilot (bank toward the next ring, pitch for its altitude), so
// the frame is what real play looks like and the same seed always gives the
// same frame.
import { MISSIONS, RUNWAYS, STEP } from './config.js';
import { clamp } from './random.js';
import { createWorld, nextRing, startSortie, stepWorld } from './world.js';

const SAMPLE = STEP;

function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

// Steer toward the next ring; on the final approach, steer for the runway.
function autopilot(world) {
  const p = world.plane;
  const ring = nextRing(world);
  let tx;
  let ty;
  let tz;
  let throttle = 0.8;
  if (!ring) {
    // A stabilised approach: join the pattern on the runway's axis, step
    // down, and once lined up commit to the final — the target stops moving,
    // so the aircraft settles on the centreline instead of weaving. Flying
    // past the far end without landing is a go-around: climb out and rejoin.
    if (!world.appr) {
      const r = RUNWAYS[world.mission.landAt];
      const mid = (r.z0 + r.z1) / 2;
      const northbound = p.z < mid;
      world.appr = {
        r,
        northbound,
        nearZ: northbound ? r.z0 : r.z1,
        farZ: northbound ? r.z1 : r.z0,
        dir: northbound ? 1 : -1,
        committed: false,
      };
    }
    const a = world.appr;
    const distToNear = Math.hypot(a.r.x - p.x, a.nearZ - p.z);
    const runwayHeading = a.dir > 0 ? 0 : Math.PI;
    const aligned = Math.abs(wrapAngle(runwayHeading - p.heading)) < 0.5;
    if (!a.committed && distToNear < 450 && aligned) a.committed = true;
    if (a.committed && (p.z - a.farZ) * a.dir > 350) a.committed = false;
    if (a.committed) {
      // Aim below the strip: the descent must not level off at 4 m and
      // overfly the runway — the ground itself stops the descent.
      tx = a.r.x; ty = -8; tz = a.farZ + a.dir * 300;
      throttle = 0.3;
    } else if (distToNear > 900) {
      tx = a.r.x; ty = 90; tz = a.nearZ - a.dir * 700;
      throttle = 0.7;
    } else {
      tx = a.r.x; ty = 25; tz = a.nearZ + a.dir * 150;
      throttle = 0.55;
    }
  } else {
    tx = ring.x;
    ty = ring.y;
    tz = ring.z;
    const dist = Math.hypot(ring.x - p.x, ring.y - p.y, ring.z - p.z);
    if (dist < 120) throttle = 0.65;
  }
  const wantHeading = Math.atan2(tx - p.x, tz - p.z);
  const headingErr = wrapAngle(wantHeading - p.heading);
  // On the final, correct gently: a hard bank this close to the ground is
  // how approaches turn into weaves.
  const gain = world.appr && world.appr.committed ? 1.0 : 1.6;
  const cap = world.appr && world.appr.committed ? 0.7 : 1;
  const roll = clamp(headingErr * gain, -cap, cap);
  const altErr = ty - p.y;
  // On the final the descent is capped shallow: a steep dive plants the
  // aircraft in the grass short of the strip.
  const pitchFloor = world.appr && world.appr.committed ? -0.35 : -0.8;
  const pitch = clamp(altErr * 0.03 + (p.speed < 24 ? 0.15 : 0), pitchFloor, 0.8);
  return { pitch, roll, throttle };
}

// Fly the world forward for `seconds`, steering with the autopilot.
function flyFor(world, seconds) {
  startSortie(world);
  const steps = Math.round(seconds / SAMPLE);
  for (let i = 0; i < steps; i += 1) {
    stepWorld(world, autopilot(world), SAMPLE);
    if (world.state !== 'flying') break;
  }
}

// Straight takeoff run: full throttle, rotate, climb to about 60 m.
function flyTakeoff(world, seconds) {
  startSortie(world);
  const steps = Math.round(seconds / SAMPLE);
  for (let i = 0; i < steps; i += 1) {
    const p = world.plane;
    const pitch = p.speed > 26 ? clamp((60 - p.y) * 0.04, -0.5, 0.7) : 0;
    stepWorld(world, { pitch, roll: 0, throttle: 1 }, SAMPLE);
    if (world.state !== 'flying') break;
  }
}

/**
 * Stage the named scene and return the view the renderer draws:
 * cover (mid-flight, ring ahead), takeoff (rotating off the home strip),
 * title (the airfield at dawn), dusk (storm run in gusting evening light).
 * `seconds` overrides a scene's default flight time, so the framing can be
 * tuned to catch the aircraft mid-turn with the next ring off-centre.
 */
export function stageShot(name, seconds) {
  if (name === 'cover') {
    const world = createWorld(1);
    flyFor(world, seconds ?? 42);
    return { world, screen: 'play', missions: MISSIONS, selected: 1, progress: 2, stars: [3, 2, 0], best: 0, starsEarned: 0, totalScore: 0 };
  }
  if (name === 'takeoff') {
    const world = createWorld(0);
    flyTakeoff(world, seconds ?? 13.5);
    return { world, screen: 'play', missions: MISSIONS, selected: 0, progress: 2, stars: [3, 2, 0], best: 0, starsEarned: 0, totalScore: 0 };
  }
  if (name === 'dusk') {
    const world = createWorld(2);
    flyFor(world, seconds ?? 36);
    return { world, screen: 'play', missions: MISSIONS, selected: 2, progress: 2, stars: [3, 2, 0], best: 0, starsEarned: 0, totalScore: 0 };
  }
  // title (and anything unknown): the airfield at dawn, engine idling.
  // A fresh save: nothing unlocked yet, no best score — the scene shows the
  // game as a new pilot finds it.
  const world = createWorld(0);
  world.plane.throttle = 0.25;
  return { world, screen: 'title', missions: MISSIONS, selected: 0, progress: 0, stars: [0, 0, 0], best: 0, starsEarned: 0, totalScore: 0 };
}
