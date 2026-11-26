// The flight model: an arcade plane with throttle, pitch, bank and turn,
// stall, wind and fuel. Pure functions of state + input, no DOM anywhere,
// so the same code runs in the browser and in the Node tests.
import { FLIGHT } from './config.js';
import { clamp } from './random.js';
import { heightAt } from './terrain.js';

// Control input for one step: pitch/roll in [-1, 1], throttle in [0, 1].
export function createPlane(start) {
  return {
    x: start.x,
    y: start.y,
    z: start.z,
    heading: start.heading,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    vy: 0,
    fuel: 1,
    damage: 0,
    airborne: false,
    landed: false,
    groundSpeed: 0,
  };
}

// One fixed step. `wind` is { x, z } in m/s (a gust shove), `seed` for terrain.
// Returns nothing; mutates `p`. Events are read by the world layer.
export function stepPlane(p, input, dt, wind, seed) {
  const f = FLIGHT;
  const stalled = p.speed < f.stallSpeed && p.airborne;

  // Throttle moves toward the lever; fuel burns with the lever.
  p.throttle = clamp(p.throttle + (input.throttle - p.throttle) * Math.min(1, dt * 2.2), 0, 1);
  const burn = (f.fuelIdleBurn + (f.fuelBurn - f.fuelIdleBurn) * p.throttle) * dt;
  p.fuel = Math.max(0, p.fuel - burn);
  const thrust = p.fuel > 0 ? 1 : 0;

  // Pitch and roll ease toward the stick.
  const pitchTarget = clamp(input.pitch, -1, 1) * f.maxPitch * (stalled ? 0.35 : 1);
  const rollTarget = clamp(input.roll, -1, 1) * f.maxRoll;
  p.pitch += clamp(pitchTarget - p.pitch, -f.pitchRate * dt, f.pitchRate * dt);
  p.roll += clamp(rollTarget - p.roll, -f.rollRate * dt, f.rollRate * dt);

  // Turn follows the bank, stronger with speed: bank right (positive roll)
  // turns right, toward east, so the heading grows.
  const turnAuthority = clamp(p.speed / 45, 0, 1) * (p.airborne ? 1 : 0.25);
  p.heading += p.roll * f.turnRate * turnAuthority * dt;
  p.heading = (p.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI;

  // Speed chases the throttle's target: brisk acceleration, and a gentle
  // glide deceleration when the lever comes back (a real aeroplane does not
  // stop in two seconds when the pilot throttles down).
  const target = thrust * p.throttle * f.maxSpeed;
  if (p.speed < target) {
    p.speed = Math.min(target, p.speed + f.accel * dt);
  } else if (p.speed > target) {
    const drag = 4 + (f.drag * p.speed * p.speed) / f.maxSpeed;
    p.speed = Math.max(target, p.speed - drag * dt);
  }

  // Vertical speed: pitch lifts, gravity pulls, stall drops the nose.
  const lift = Math.sin(p.pitch) * f.climbRate * clamp(p.speed / f.cruiseSpeed, 0, 1.4);
  const sink = stalled ? -f.gravity * 0.55 : 0;
  const groundEffect = !p.airborne && p.speed > 8 ? 0.4 : 0;
  p.vy = lift + sink + groundEffect * Math.sin(p.pitch) * 4;

  // Liftoff: fast enough and pitched up, or already flying.
  if (!p.airborne && p.speed > 26 && p.pitch > 0.12) p.airborne = true;
  if (p.airborne && p.speed < 12 && p.y <= heightAt(p.x, p.z, seed) + 2.5) {
    p.airborne = false;
  }

  const sinH = Math.sin(p.heading);
  const cosH = Math.cos(p.heading);
  const vx = sinH * p.speed + wind.x;
  const vz = cosH * p.speed + wind.z;
  p.x += vx * dt;
  p.z += vz * dt;
  p.y += p.vy * dt;
  p.groundSpeed = Math.hypot(vx, vz);

  // Stay inside the valley; the sea turns the aircraft back gently — but
  // only while it is actually flying outward, so a stalled aircraft on the
  // boundary is never spun around by the nudge.
  const vxNow = Math.sin(p.heading) * p.speed + wind.x;
  const vzNow = Math.cos(p.heading) * p.speed + wind.z;
  if (p.x > 2900 && vxNow > 0) p.heading -= 0.5 * dt;
  if (p.x < -2900 && vxNow < 0) p.heading += 0.5 * dt;
  p.x = clamp(p.x, -2950, 2950);
  if (p.z >= 8400 && vzNow > 0) p.heading += (p.heading > 0 ? -1 : 1) * 0.5 * dt;
  if (p.z <= -1600 && vzNow < 0) p.heading += (p.heading > 0 ? -1 : 1) * 0.5 * dt;
  p.z = clamp(p.z, -1600, 8400);

  // The ground is a hard floor.
  const ground = heightAt(p.x, p.z, seed);
  if (p.y < ground + 1.2) {
    p.y = ground + 1.2;
    if (p.airborne) {
      // A hard arrival damages the airframe; a gentle one is a landing.
      const hard = -p.vy > 6 || p.speed > 55;
      if (hard) p.damage = Math.min(100, p.damage + 30 + (-p.vy - 6) * 4 + Math.max(0, p.speed - 55));
      p.airborne = false;
      p.vy = 0;
      if (p.damage < 100) p.speed *= 0.55;
    }
  }
}

// Knots for the HUD: 1 m/s is 1.944 knots.
export function knots(ms) {
  return ms * 1.944;
}

// Feet for the HUD: 1 m is 3.281 ft.
export function feet(m) {
  return m * 3.281;
}

// Compass heading in degrees: 0 is north (+z), 90 is east (+x).
export function headingDegrees(heading) {
  return ((heading * 180) / Math.PI + 360) % 360;
}
