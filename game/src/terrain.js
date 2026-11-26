// The valley: its hills, river, road, fields, towns, trees and clouds.
// Everything is a pure function of the mission seed, so the same seed always
// grows the same place. Units are metres; x east, z north, y up.
import { RUNWAYS } from './config.js';
import { clamp, hash2, noise2 } from './random.js';

// The river winds east and west as it runs north.
export function riverX(z) {
  return 500 * Math.sin(z * 0.0009 + 1.7) + 250 * Math.sin(z * 0.0023 + 0.4);
}

// The old coast road runs roughly north, a few hundred metres west of home.
export function roadX(z) {
  return -350 + 120 * Math.sin(z * 0.0007 + 0.9);
}

// Gentle hills, flattened to a table near each runway so the strips sit level.
export function heightAt(x, z, seed) {
  let h = 14 * noise2(x, z, 900, seed) + 7 * noise2(x, z, 260, seed + 5) - 10;
  h += 26 * Math.max(0, noise2(x, z, 2400, seed + 9) - 0.62) * 2.2;
  for (const r of RUNWAYS) {
    const dx = Math.abs(x - r.x);
    const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
    const d = Math.sqrt(dx * dx + dz * dz);
    const flat = clamp((d - 60) / 260, 0, 1);
    h *= flat * flat * (3 - 2 * flat);
  }
  return Math.max(0, h);
}

// Crop of a field cell: 0 grass, 1 wheat, 2 forest, 3 meadow.
export function fieldKind(ix, iz, seed) {
  const v = hash2(ix, iz, seed + 21);
  if (v < 0.16) return 2;
  if (v < 0.34) return 1;
  if (v < 0.46) return 3;
  return 0;
}

const FIELD_COLORS = {
  0: ['#5d8a3c', '#679743', '#547f36'],
  1: ['#c2a24e', '#cfae57', '#b59244'],
  2: ['#2f5d2a', '#356b2f', '#2a5226'],
  3: ['#7fae4e', '#8abd58', '#74a245'],
};

// The colour of the ground at (x, z): patchwork fields, river, road, runway,
// sea beyond the valley's edge. `shade` darkens with the hill slope.
export function groundColor(x, z, seed) {
  const ix = Math.floor(x / 140);
  const iz = Math.floor(z / 140);
  const kind = fieldKind(ix, iz, seed);
  const palette = FIELD_COLORS[kind];
  const shade = palette[Math.floor(hash2(ix, iz, seed + 31) * 3) % 3];
  // River band.
  if (Math.abs(x - riverX(z)) < 26) return '#3f7fb5';
  if (Math.abs(x - riverX(z)) < 30) return '#c9b078';
  // Coast road with a dashed centre line.
  const rx = roadX(z);
  if (Math.abs(x - rx) < 4.5) {
    return Math.floor(z / 14) % 2 === 0 ? '#5a5a5e' : '#d8d8d0';
  }
  if (Math.abs(x - rx) < 6) return '#8a8a80';
  // Runway strips: asphalt, white edge lines and centre dashes.
  for (const r of RUNWAYS) {
    if (z >= r.z0 - 20 && z <= r.z1 + 20 && Math.abs(x - r.x) < r.width / 2) {
      const edge = Math.abs(x - r.x);
      if (edge > r.width / 2 - 2) return '#f2f2e8';
      if (edge < 1.6 && Math.floor(z / 26) % 2 === 0) return '#f2f2e8';
      return '#3c3c40';
    }
    if (z >= r.z0 - 20 && z <= r.z1 + 20 && Math.abs(x - r.x) < r.width / 2 + 5) return '#7a7a6a';
  }
  // Sea far east and far north; the valley is an island coast.
  if (x > 2600 || z > 8200 || z < -1400) return '#2e6f9e';
  if (x > 2560 || z > 8160 || z < -1360) return '#c9b078';
  // Hill shading: higher ground reads lighter.
  const h = heightAt(x, z, seed);
  if (h > 22) return '#8a9a7a';
  if (h > 14) return '#6d8a52';
  return shade;
}

// Towns: three hamlets beside the road, each a cluster of houses and trees.
export const TOWNS = [
  { x: -430, z: 1500, houses: 9, seed: 3 },
  { x: -260, z: 3400, houses: 12, seed: 7 },
  { x: 640, z: 5100, houses: 8, seed: 11 },
];

// Deterministic scatter: trees and houses near (x, z), from the cell hash.
export function scatterNear(x, z, radius, seed, count) {
  const out = [];
  const cx = Math.floor(x / 200);
  const cz = Math.floor(z / 200);
  for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
    for (let gz = cz - 1; gz <= cz + 1; gz += 1) {
      const n = 3 + Math.floor(hash2(gx, gz, seed + 41) * 4);
      for (let i = 0; i < n; i += 1) {
        const px = gx * 200 + hash2(gx * 7 + i, gz, seed + 43) * 200;
        const pz = gz * 200 + hash2(gx, gz * 7 + i, seed + 47) * 200;
        const dx = px - x;
        const dz = pz - z;
        if (dx * dx + dz * dz > radius * radius) continue;
        if (Math.abs(px - riverX(pz)) < 40) continue;
        const kind = fieldKind(Math.floor(px / 140), Math.floor(pz / 140), seed);
        if (kind === 1) continue; // wheat fields stay clear
        out.push({
          x: px,
          z: pz,
          tree: hash2(gx * 3 + i, gz * 5, seed + 53) < (kind === 2 ? 0.9 : 0.45),
          s: 0.8 + hash2(gx, gz + i, seed + 59) * 0.7,
        });
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

// Clouds drift slowly; each has a fixed seed position and size. They sit
// well above the flight path so none crowds the camera at low altitude.
export function makeClouds(seed) {
  const clouds = [];
  for (let i = 0; i < 42; i += 1) {
    clouds.push({
      x: (hash2(i, 1, seed + 61) - 0.5) * 7000,
      z: hash2(i, 2, seed + 63) * 9000 - 1000,
      y: 320 + hash2(i, 3, seed + 67) * 240,
      s: 60 + hash2(i, 4, seed + 71) * 130,
      a: 0.5 + hash2(i, 5, seed + 73) * 0.4,
    });
  }
  return clouds;
}

// Far mountain ridge silhouettes, one triangle per peak. Low and wide, so
// they read as a distant range rather than a wall of teeth.
export function makeRidge(seed, far) {
  const peaks = [];
  const n = far ? 26 : 18;
  for (let i = 0; i < n; i += 1) {
    peaks.push({
      t: i / (n - 1),
      h: (far ? 0.05 : 0.08) + hash2(i, far ? 9 : 8, seed + 79) * (far ? 0.08 : 0.11),
      w: 0.08 + hash2(i, far ? 10 : 11, seed + 83) * 0.08,
    });
  }
  return peaks;
}
