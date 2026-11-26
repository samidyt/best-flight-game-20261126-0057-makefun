// Skyline Courier — shared constants, mission definitions and palette.
// Everything is in metres, seconds and knots where the HUD says so.
export const STEP = 1 / 60;

// Flight model tuning.
export const FLIGHT = {
  maxSpeed: 92, // m/s at full throttle (~179 kt)
  cruiseSpeed: 58,
  stallSpeed: 22, // below this the wing stops flying and the nose drops
  accel: 14, // m/s^2 toward the throttle's target speed
  drag: 0.06, // glide deceleration grows with the square of speed
  climbRate: 16, // m/s of vertical speed at full pitch authority
  pitchRate: 0.85, // rad/s of pitch change
  rollRate: 1.9, // rad/s of roll change
  turnRate: 0.55, // rad/s of heading change at full bank
  maxPitch: 0.62,
  maxRoll: 1.15,
  gravity: 9.8,
  fuelBurn: 0.0028, // fraction of tank per second at full throttle (~6 min)
  fuelIdleBurn: 0.0008,
  crashSpeed: 34, // hitting the ground faster than this (vertical) is a crash
};

// Chase camera.
export const CAMERA = {
  behind: 15, // metres behind the aircraft
  above: 4.5, // metres above the aircraft
  lookAhead: 34,
  fov: 1.22, // radians, vertical
};

// Runways: long strips along +z. Landing counts only on a strip.
export const RUNWAYS = [
  { name: 'Home Strip', x: 0, z0: 0, z1: 620, width: 34 },
  { name: 'Far Strip', x: 900, z0: 6180, z1: 6800, width: 34 },
];

// Ring radius in metres; passing within it counts.
export const RING_RADIUS = 16;

// One sortie: a dawn solo, a noon island hop, a dusk storm run.
export const MISSIONS = [
  {
    id: 'solo',
    name: 'First Solo',
    subtitle: 'Dawn over the home valley',
    seed: 11,
    sky: 'dawn',
    timeLimit: 260,
    fuel: 1,
    wind: 0,
    start: { x: 0, y: 2, z: 60, heading: 0 },
    landAt: 0, // runway index to land on
    rings: [
      { x: 0, y: 70, z: 900 },
      { x: -260, y: 90, z: 1600 },
      { x: 320, y: 80, z: 2400 },
      { x: -120, y: 110, z: 3200 },
      { x: 60, y: 70, z: 4000 },
    ],
    brief:
      'Take off from the Home Strip, fly the five rings over the valley, ' +
      'then come back and land on the same strip. Gentle dawn air — a good first solo.',
  },
  {
    id: 'hop',
    name: 'Island Hop',
    subtitle: 'Noon mail run to the far strip',
    seed: 23,
    sky: 'noon',
    timeLimit: 320,
    fuel: 1,
    wind: 0.25,
    start: { x: 0, y: 2, z: 60, heading: 0 },
    landAt: 1,
    rings: [
      { x: 120, y: 80, z: 900 },
      { x: -300, y: 100, z: 1700 },
      { x: 420, y: 90, z: 2500 },
      { x: -80, y: 120, z: 3300 },
      { x: 620, y: 100, z: 4100 },
      { x: 300, y: 130, z: 4900 },
      { x: 760, y: 90, z: 5600 },
      { x: 900, y: 70, z: 6100 },
    ],
    brief:
      'The mail has to reach the far strip before noon fades. Eight rings ' +
      'across the river and the fields, then put her down on the Far Strip. ' +
      'Watch the fuel gauge — there is no second chance out there.',
  },
  {
    id: 'storm',
    name: 'Storm Run',
    subtitle: 'Dusk run through the gusts',
    seed: 37,
    sky: 'dusk',
    timeLimit: 340,
    fuel: 1,
    wind: 1,
    start: { x: 0, y: 2, z: 60, heading: 0 },
    landAt: 0,
    rings: [
      { x: -180, y: 90, z: 850 },
      { x: 260, y: 120, z: 1500 },
      { x: -420, y: 100, z: 2200 },
      { x: 180, y: 140, z: 2900 },
      { x: -60, y: 90, z: 3600 },
      { x: 480, y: 130, z: 4300 },
      { x: -240, y: 110, z: 5000 },
      { x: 120, y: 150, z: 5700 },
      { x: 560, y: 100, z: 6400 },
      { x: 40, y: 80, z: 4600 },
    ],
    brief:
      'A storm is rolling in and the last parcel cannot wait. Ten rings in ' +
      'gusting dusk air, then land home before the light goes. The wind will ' +
      'shove you sideways — fly the aircraft, not the plan.',
  },
];

// Sky palettes per mission time of day.
export const SKIES = {
  dawn: {
    top: '#2e4a7a', mid: '#e8a06a', low: '#f7cf9a', sun: '#ffd9a0',
    sunX: 0.72, sunY: 0.30, haze: 'rgba(247, 207, 154, 0.55)',
    mountain: '#5d6f8e', mountainFar: '#7d8aa5',
  },
  noon: {
    top: '#2f6fd0', mid: '#7fb2e8', low: '#cfe6f7', sun: '#fff3c4',
    sunX: 0.30, sunY: 0.16, haze: 'rgba(207, 230, 247, 0.45)',
    mountain: '#4f6d8f', mountainFar: '#7d9bb8',
  },
  dusk: {
    top: '#1d2340', mid: '#8a4a6b', low: '#e07a4e', sun: '#ff9a5c',
    sunX: 0.22, sunY: 0.34, haze: 'rgba(224, 122, 78, 0.5)',
    mountain: '#3a3350', mountainFar: '#5a4a68',
  },
};

export const BEST_KEY = 'skyline-courier-best';
export const PROGRESS_KEY = 'skyline-courier-progress';
