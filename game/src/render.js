// The renderer: a pseudo-3D chase view over the valley, the aircraft in
// frame, and a lit HUD. Canvas 2D only, no images, no network.
import { CAMERA, FLIGHT, RUNWAYS, SKIES } from './config.js';
import { clamp, lerp } from './random.js';
import { feet, headingDegrees, knots } from './physics.js';
import { groundColor, heightAt, makeClouds, makeRidge, riverX, roadX, scatterNear, TOWNS } from './terrain.js';
import { nextRing } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_BRIEF = 'brief';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_LANDED = 'landed';
export const SCREEN_CRASHED = 'crashed';
export const SCREEN_TIMEOUT = 'timeout';
export const SCREEN_FUELOUT = 'fuelout';
export const SCREEN_CAMPAIGN = 'campaign';

const TAU = Math.PI * 2;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const ground = document.createElement('canvas');
  const gctx = ground.getContext('2d');
  let width = 0;
  let height = 0;
  let clouds = [];
  let ridgeNear = [];
  let ridgeFar = [];
  let seed = 0;

  function resize(w, h) {
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
    ground.width = Math.ceil(w / 2);
    ground.height = Math.ceil(h / 2);
  }

  function setWorld(missionSeed) {
    seed = missionSeed;
    clouds = makeClouds(seed);
    ridgeNear = makeRidge(seed, false);
    ridgeFar = makeRidge(seed, true);
  }

  // Camera basis from the aircraft: position, forward, right, up, focal.
  function camera(p) {
    const sinH = Math.sin(p.heading);
    const cosH = Math.cos(p.heading);
    const cp = Math.cos(p.pitch);
    const sp = Math.sin(p.pitch);
    // Look direction follows heading and pitch.
    const f = [sinH * cp, sp, cosH * cp];
    const cam = [p.x - f[0] * CAMERA.behind, p.y - f[1] * CAMERA.behind + CAMERA.above, p.z - f[2] * CAMERA.behind];
    const look = [p.x + f[0] * CAMERA.lookAhead, p.y + f[1] * CAMERA.lookAhead, p.z + f[2] * CAMERA.lookAhead];
    let fx = look[0] - cam[0];
    let fy = look[1] - cam[1];
    let fz = look[2] - cam[2];
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    // Right = up x forward, normalised (horizontal by construction); the
    // old code used forward x up here, which mirrored the world east-west.
    let rx = fz;
    let rz = -fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // Up = forward x right: perpendicular to both, pointing at the sky.
    const ux = fy * rz;
    const uy = fz * rx - fx * rz;
    const uz = -fy * rx;
    const focal = (height / 2) / Math.tan(CAMERA.fov / 2);
    return { cam, f: [fx, fy, fz], r: [rx, 0, rz], u: [ux, uy, uz], focal };
  }

  // Project a world point; returns null when behind the camera.
  function project(cam, x, y, z) {
    const dx = x - cam.cam[0];
    const dy = y - cam.cam[1];
    const dz = z - cam.cam[2];
    const d = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (d < 1.5) return null;
    const sx = width / 2 + ((dx * cam.r[0] + dz * cam.r[2]) * cam.focal) / d;
    const sy = height / 2 - ((dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2]) * cam.focal) / d;
    return { x: sx, y: sy, d };
  }

  function horizonY(cam) {
    const fy = cam.f[1];
    const t = fy / Math.sqrt(Math.max(0.0001, 1 - fy * fy));
    return height / 2 + cam.focal * t;
  }

  function drawSky(cam, sky, time) {
    const hy = horizonY(cam);
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(0, hy));
    g.addColorStop(0, sky.top);
    g.addColorStop(0.55, sky.mid);
    g.addColorStop(1, sky.low);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, Math.max(0, hy) + 1);
    // Sun: a soft disc with a glow.
    const sunX = sky.sunX * width;
    const sunY = sky.sunY * Math.max(60, hy);
    const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 130);
    glow.addColorStop(0, sky.sun);
    glow.addColorStop(0.35, sky.sun + 'cc');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 140, sunY - 140, 280, 280);
    // Mountain ridges: two screen-space silhouettes under the sky.
    for (const [ridge, color] of [[ridgeFar, sky.mountainFar], [ridgeNear, sky.mountain]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, hy + 2);
      for (const peak of ridge) {
        const px = peak.t * width;
        const pw = peak.w * width;
        const ph = peak.h * height;
        ctx.lineTo(px - pw, hy + 2);
        ctx.lineTo(px, hy - ph);
        ctx.lineTo(px + pw, hy + 2);
      }
      ctx.lineTo(width, hy + 2);
      ctx.closePath();
      ctx.fill();
    }
    // Haze band just above the horizon.
    ctx.fillStyle = sky.haze;
    ctx.fillRect(0, Math.max(0, hy - 14), width, 16);
  }

  // The ground, painted at half resolution into an offscreen canvas: each
  // row is a constant-depth slice of the valley floor. The offscreen stays
  // transparent above the horizon so the sky shows through.
  function drawGround(cam, sky) {
    const hy = horizonY(cam);
    const gw = ground.width;
    const gh = ground.height;
    const hy2 = hy / 2;
    const cy2 = height / 4;
    const camY = Math.max(2, cam.cam[1]);
    gctx.clearRect(0, 0, gw, gh);
    for (let row = Math.floor(hy2) + 1; row < gh; row += 1) {
      // u-coefficient of the ray through this row (negative below centre).
      const k = (-(row - cy2) * 2) / cam.focal;
      // The ray's vertical component (r is horizontal, so it adds nothing).
      const dirY = cam.f[1] + k * cam.u[1];
      if (dirY >= -0.02) continue;
      // Far rows clamp to the haze distance instead of vanishing: the ground
      // then runs to the horizon instead of stopping at a flat band.
      const t = Math.min(9000, -camY / dirY);
      if (t <= 0) continue;
      // Ray without its right component: f + k*u.
      const baseX = cam.f[0] + k * cam.u[0];
      const baseZ = cam.f[2] + k * cam.u[2];
      for (let col = 0; col < gw; col += 2) {
        // Full-resolution pixel offset from the centre, over the focal length.
        const a = ((col - gw / 2) * 2) / cam.focal;
        const wx = cam.cam[0] + (baseX + a * cam.r[0]) * t;
        const wz = cam.cam[2] + (baseZ + a * cam.r[2]) * t;
        gctx.fillStyle = groundColor(wx, wz, seed);
        gctx.fillRect(col, row, 2, 1);
      }
    }
    ctx.drawImage(ground, 0, 0, width, height);
    // Distance haze over the ground, thickening toward the horizon.
    const haze = ctx.createLinearGradient(0, hy, 0, height);
    haze.addColorStop(0, sky.haze);
    haze.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, hy, width, height - hy);
  }

  // Billboards sorted far to near: clouds, rings, trees, houses, windsock.
  // `showRingGuides` is false on menus, where a floating RING label would
  // sit on top of the panels.
  function drawObjects(cam, world, time, showRingGuides) {
    const p = world.plane;
    const items = [];
    for (const c of clouds) {
      const pr = project(cam, c.x, c.y, c.z);
      if (pr) items.push({ d: pr.d, kind: 'cloud', pr, c });
    }
    for (let i = 0; i < world.rings.length; i += 1) {
      const ring = world.rings[i];
      const pr = project(cam, ring.x, ring.y, ring.z);
      if (pr) items.push({ d: pr.d, kind: 'ring', pr, ring, next: i === world.ringIndex });
    }
    const near = scatterNear(cam.cam[0], cam.cam[2], 1100, seed, 260);
    for (const o of near) {
      const gy = heightAt(o.x, o.z, seed);
      const pr = project(cam, o.x, gy + (o.tree ? 7 : 5) * o.s, o.z);
      if (pr) items.push({ d: pr.d, kind: o.tree ? 'tree' : 'house', pr, o });
    }
    for (const town of TOWNS) {
      for (let i = 0; i < town.houses; i += 1) {
        const hx = town.x + (Math.sin(i * 12.9898 + town.seed) * 90);
        const hz = town.z + (Math.cos(i * 7.233 + town.seed) * 90);
        const gy = heightAt(hx, hz, seed);
        const pr = project(cam, hx, gy + 4, hz);
        if (pr) items.push({ d: pr.d, kind: 'house', pr, o: { x: hx, z: hz, s: 1 } });
      }
    }
    // Windsock at the home strip.
    const ws = project(cam, 26, heightAt(26, 300, seed) + 9, 300);
    if (ws) items.push({ d: ws.d, kind: 'sock', pr: ws });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      const { pr } = it;
      if (pr.x < -160 || pr.x > width + 160 || pr.y < -160 || pr.y > height + 160) continue;
      if (it.kind === 'cloud') {
        // A cloud right on the camera reads as a giant white balloon: skip
        // the nearest ones and cap how big one can draw.
        if (pr.d < 400) continue;
        const s = Math.min(200, (it.c.s * cam.focal) / pr.d);
        ctx.fillStyle = `rgba(255,255,255,${it.c.a})`;
        for (const [ox, oy, r] of [[-0.5, 0, 0.5], [0, -0.18, 0.62], [0.55, 0.05, 0.45]]) {
          ctx.beginPath();
          ctx.ellipse(pr.x + ox * s, pr.y + oy * s, r * s, r * s * 0.55, 0, 0, TAU);
          ctx.fill();
        }
      } else if (it.kind === 'ring') {
        const r = (16 * cam.focal) / pr.d;
        const passed = it.ring.passed;
        const isNext = it.next;
        ctx.save();
        ctx.lineWidth = Math.max(2, r * 0.16);
        ctx.strokeStyle = passed ? 'rgba(126,226,160,0.85)' : isNext ? '#ffd24a' : 'rgba(255,210,74,0.55)';
        ctx.shadowColor = isNext ? '#ffbf2e' : '#ffd24a';
        ctx.shadowBlur = isNext ? 26 : 10;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, r, 0, TAU);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1, r * 0.05);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, r * 0.82, 0, TAU);
        ctx.stroke();
        if (isNext && showRingGuides) {
          // A light beam down to the ground so the next ring is findable.
          const gp = project(cam, it.ring.x, heightAt(it.ring.x, it.ring.z, seed) + 1, it.ring.z);
          if (gp) {
            ctx.strokeStyle = 'rgba(255,210,74,0.35)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pr.x, pr.y);
            ctx.lineTo(gp.x, gp.y);
            ctx.stroke();
          }
          ctx.fillStyle = '#ffd24a';
          ctx.font = `bold ${Math.max(13, Math.min(22, r * 0.35))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(`RING ${world.ringIndex + 1}`, pr.x, pr.y - r - 10);
        }
        ctx.restore();
      } else if (it.kind === 'tree') {
        const s = (9 * cam.focal) / pr.d * it.o.s;
        if (s < 2) continue;
        ctx.fillStyle = '#2f5d2a';
        ctx.beginPath();
        ctx.moveTo(pr.x, pr.y - s * 1.6);
        ctx.lineTo(pr.x - s * 0.7, pr.y);
        ctx.lineTo(pr.x + s * 0.7, pr.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#5a4632';
        ctx.fillRect(pr.x - s * 0.08, pr.y, s * 0.16, s * 0.5);
      } else if (it.kind === 'house') {
        const s = (10 * cam.focal) / pr.d * it.o.s;
        if (s < 2.5) continue;
        ctx.fillStyle = '#e8dcc0';
        ctx.fillRect(pr.x - s * 0.5, pr.y - s * 0.55, s, s * 0.55);
        ctx.fillStyle = '#b0492f';
        ctx.beginPath();
        ctx.moveTo(pr.x - s * 0.62, pr.y - s * 0.55);
        ctx.lineTo(pr.x, pr.y - s * 1.05);
        ctx.lineTo(pr.x + s * 0.62, pr.y - s * 0.55);
        ctx.closePath();
        ctx.fill();
      } else if (it.kind === 'sock') {
        const s = (10 * cam.focal) / pr.d;
        ctx.strokeStyle = '#ff5a3c';
        ctx.lineWidth = Math.max(1.5, s * 0.12);
        ctx.beginPath();
        ctx.moveTo(pr.x, pr.y);
        ctx.lineTo(pr.x, pr.y - s);
        ctx.stroke();
        ctx.fillStyle = '#ff8a5c';
        ctx.beginPath();
        ctx.moveTo(pr.x, pr.y - s);
        ctx.lineTo(pr.x + s * 0.9, pr.y - s * 0.8);
        ctx.lineTo(pr.x, pr.y - s * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // The aircraft, seen from behind and above: wings, tail, fuselage, prop.
  // It sits low in the frame so a ring ahead stays visible above it.
  function drawPlane(p, time) {
    const cx = width / 2;
    const cy = height * 0.66 + Math.sin(p.pitch) * 26;
    const span = Math.min(width * 0.21, 185);
    const blink = Math.floor(time * 2) % 2 === 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.roll);
    ctx.scale(1, 1 + Math.abs(p.pitch) * 0.25);
    // Prop blur disc at the nose (top of the sprite).
    const propR = span * 0.15;
    ctx.fillStyle = 'rgba(40,40,46,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, -span * 0.44, propR, propR * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,40,46,0.5)';
    ctx.lineWidth = 2;
    const pa = time * 22;
    ctx.beginPath();
    ctx.moveTo(Math.cos(pa) * propR, -span * 0.44 + Math.sin(pa) * propR * 0.28);
    ctx.lineTo(-Math.cos(pa) * propR, -span * 0.44 - Math.sin(pa) * propR * 0.28);
    ctx.stroke();
    // Wings.
    ctx.fillStyle = '#e8e2d2';
    ctx.strokeStyle = '#8a2f22';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-span, -span * 0.06);
    ctx.quadraticCurveTo(-span * 0.4, -span * 0.16, 0, -span * 0.12);
    ctx.quadraticCurveTo(span * 0.4, -span * 0.16, span, -span * 0.06);
    ctx.quadraticCurveTo(span * 0.4, span * 0.02, 0, span * 0.02);
    ctx.quadraticCurveTo(-span * 0.4, span * 0.02, -span, -span * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Fuselage, tapering toward the nose.
    ctx.fillStyle = '#f4efe0';
    ctx.strokeStyle = '#8a2f22';
    ctx.beginPath();
    ctx.moveTo(-span * 0.085, span * 0.36);
    ctx.quadraticCurveTo(-span * 0.11, -span * 0.08, -span * 0.06, -span * 0.42);
    ctx.quadraticCurveTo(0, -span * 0.48, span * 0.06, -span * 0.42);
    ctx.quadraticCurveTo(span * 0.11, -span * 0.08, span * 0.085, span * 0.36);
    ctx.quadraticCurveTo(0, span * 0.42, -span * 0.085, span * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Red cheatline and tail stripe.
    ctx.fillStyle = '#c23b2a';
    ctx.fillRect(-span * 0.10, -span * 0.02, span * 0.20, span * 0.045);
    // One canopy, not two eyes.
    ctx.fillStyle = '#1e2c3a';
    ctx.beginPath();
    ctx.ellipse(0, -span * 0.28, span * 0.045, span * 0.075, 0, 0, TAU);
    ctx.fill();
    // Tail fin and stabiliser.
    ctx.fillStyle = '#c23b2a';
    ctx.beginPath();
    ctx.moveTo(-span * 0.045, span * 0.34);
    ctx.lineTo(0, span * 0.54);
    ctx.lineTo(span * 0.045, span * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8e2d2';
    ctx.strokeStyle = '#8a2f22';
    ctx.beginPath();
    ctx.ellipse(0, span * 0.38, span * 0.28, span * 0.045, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // Navigation lights.
    ctx.fillStyle = '#ff4b3e';
    ctx.beginPath(); ctx.arc(-span, -span * 0.06, blink ? 4 : 2.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#37e08a';
    ctx.beginPath(); ctx.arc(span, -span * 0.06, blink ? 4 : 2.5, 0, TAU); ctx.fill();
    ctx.fillStyle = blink ? '#ffffff' : '#c9c9c9';
    ctx.beginPath(); ctx.arc(0, span * 0.52, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Rain streaks for the dusk storm.
  function drawRain(time) {
    ctx.strokeStyle = 'rgba(200,210,230,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 90; i += 1) {
      const x = ((i * 137.5 + time * 60) % (width + 40)) - 20;
      const y = ((i * 89.3 + time * 520) % (height + 40)) - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 16);
    }
    ctx.stroke();
  }

  function dial(cx, cy, r, label, valueText) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#ffd27a';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy - r + 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillText(valueText, cx, cy + r * 0.45);
    ctx.restore();
  }

  function drawHUD(world, time) {
    const p = world.plane;
    const m = world.mission;
    // Compass tape across the top.
    const tapeW = Math.min(width * 0.5, 520);
    const tapeX = (width - tapeW) / 2;
    ctx.fillStyle = 'rgba(8,12,20,0.6)';
    ctx.fillRect(tapeX, 8, tapeW, 30);
    ctx.strokeStyle = '#ffd27a';
    ctx.strokeRect(tapeX, 8, tapeW, 30);
    const hdg = headingDegrees(p.heading);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tapeX, 8, tapeW, 30);
    ctx.clip();
    for (let d = -60; d <= 60; d += 5) {
      const deg = Math.round((hdg + d) / 5) * 5;
      const off = (deg - hdg) * (tapeW / 120);
      const x = width / 2 + off;
      const major = deg % 30 === 0;
      ctx.strokeStyle = major ? '#ffd27a' : 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(x, major ? 12 : 18);
      ctx.lineTo(x, 30);
      ctx.stroke();
      if (major) {
        const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
        const deg360 = ((deg % 360) + 360) % 360;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(names[deg360] ?? String(deg360 / 10), x, 15 + 10);
      }
    }
    ctx.restore();
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(width / 2 - 6, 8);
    ctx.lineTo(width / 2 + 6, 8);
    ctx.lineTo(width / 2, 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(Math.round(hdg)).padStart(3, '0')}°`, width / 2, 36 + 14);

    // Next-ring pointer: an arrow at the screen edge when the ring is off-view.
    const ring = nextRing(world);
    if (ring && world.state === 'flying') {
      const cam = camera(p);
      const pr = project(cam, ring.x, ring.y, ring.z);
      const dist = Math.hypot(ring.x - p.x, ring.y - p.y, ring.z - p.z);
      if (!pr || pr.x < 40 || pr.x > width - 40 || pr.y < 60 || pr.y > height - 160) {
        const ang = Math.atan2(ring.x - p.x, ring.z - p.z) - p.heading;
        const ax = width / 2 + Math.sin(ang) * Math.min(width * 0.42, 420);
        const ay = height * 0.30;
        ctx.save();
        ctx.translate(ax, ay);
        // Chevron pointing toward the ring: left, right, or up when ahead.
        ctx.rotate(ang > 0.35 ? Math.PI / 2 : ang < -0.35 ? -Math.PI / 2 : 0);
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(10, 8);
        ctx.lineTo(-10, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ffd24a';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`NEXT RING ${Math.round(dist)} m`, ax, ay + 26);
      }
    }

    // Bottom instrument panel.
    const pw = Math.min(width * 0.92, 860);
    const px = (width - pw) / 2;
    const py = height - 108;
    ctx.fillStyle = 'rgba(8,12,20,0.78)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, 96, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,122,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Airspeed dial with needle.
    const asx = px + 62;
    const asy = py + 48;
    dial(asx, asy, 40, 'AIRSPEED', `${Math.round(knots(p.speed))}`);
    ctx.fillStyle = '#9fb6d8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KT', asx, asy + 30);
    const aNeedle = (-0.75 + clamp(knots(p.speed) / 200, 0, 1) * 1.5) * Math.PI;
    ctx.strokeStyle = '#ff6b5e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(asx, asy);
    ctx.lineTo(asx + Math.cos(aNeedle - Math.PI / 2) * 32, asy + Math.sin(aNeedle - Math.PI / 2) * 32);
    ctx.stroke();
    // Artificial horizon.
    const hx = px + pw / 2 - 130;
    const hyy = py + 48;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hyy, 38, 0, TAU);
    ctx.clip();
    ctx.translate(hx, hyy);
    ctx.rotate(-p.roll);
    ctx.translate(0, clamp(p.pitch, -0.6, 0.6) * 60);
    ctx.fillStyle = '#3f7fc9';
    ctx.fillRect(-40, -80, 80, 80);
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(-40, 0, 80, 80);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-40, -1, 80, 2);
    ctx.restore();
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hyy, 38, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.moveTo(hx - 18, hyy);
    ctx.lineTo(hx - 6, hyy);
    ctx.moveTo(hx + 6, hyy);
    ctx.lineTo(hx + 18, hyy);
    ctx.stroke();
    // Altimeter dial with needle.
    const alx = px + pw / 2 + 30;
    const aly = py + 48;
    dial(alx, aly, 40, 'ALTITUDE', `${Math.round(feet(Math.max(0, p.y - heightAt(p.x, p.z, seed))))}`);
    ctx.fillStyle = '#9fb6d8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FT AGL', alx, aly + 30);
    const altNeedle = (-0.75 + clamp(feet(Math.max(0, p.y)) / 5000, 0, 1) * 1.5) * Math.PI;
    ctx.strokeStyle = '#7ee2a0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(alx, aly);
    ctx.lineTo(alx + Math.cos(altNeedle - Math.PI / 2) * 32, aly + Math.sin(altNeedle - Math.PI / 2) * 32);
    ctx.stroke();
    // Throttle + fuel bars.
    const bx = px + pw - 190;
    bar(bx, py + 16, 170, 12, p.throttle, '#ffd24a', 'THR');
    bar(bx, py + 38, 170, 12, p.fuel, p.fuel < 0.25 ? '#ff6b5e' : '#7ee2a0', 'FUEL');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`VSI ${p.vy >= 0 ? '+' : ''}${Math.round(p.vy * 196)} fpm`, bx, py + 72);
    ctx.fillText(`DMG ${Math.round(p.damage)}%`, bx, py + 88);
    // Score, rings, timer.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    const mm = Math.max(0, Math.floor(world.timeLeft / 60));
    const ss = Math.max(0, Math.floor(world.timeLeft % 60));
    ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, width - 16, 24);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`SCORE ${world.score}`, width - 16, 44);
    ctx.fillText(`RINGS ${world.ringIndex}/${world.rings.length}`, width - 16, 62);
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(m.name, 16, 24);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#cfe0f2';
    ctx.fillText(m.subtitle, 16, 42);
    // Low fuel warning.
    if (p.fuel < 0.2 && Math.floor(time * 2) % 2 === 0) {
      ctx.fillStyle = '#ff6b5e';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LOW FUEL', width / 2, py - 16);
    }
    // Damage vignette.
    if (p.damage > 0) {
      const a = clamp(p.damage / 100, 0, 1) * 0.4;
      const vg = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.75);
      vg.addColorStop(0, 'rgba(255,40,20,0)');
      vg.addColorStop(1, `rgba(255,40,20,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);
    }
    // Transient message banner.
    if (world.message && world.elapsed < world.messageUntil) {
      ctx.fillStyle = 'rgba(8,12,20,0.75)';
      const tw = ctx.measureText(world.message).width + 28;
      ctx.beginPath();
      ctx.roundRect((width - tw) / 2, py - 44, tw, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(world.message, width / 2, py - 24);
    }
  }

  function bar(x, y, w, h, frac, color, label) {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w * clamp(frac, 0, 1), h, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 3);
  }

  function panel(title, lines, accent) {
    const pw = Math.min(width * 0.86, 620);
    const ph = 90 + lines.length * 26;
    const px = (width - pw) / 2;
    const py = (height - ph) / 2;
    ctx.fillStyle = 'rgba(8,12,20,0.88)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 14);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, py + 52);
    ctx.fillStyle = '#e8eef7';
    ctx.font = '15px system-ui, sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, width / 2, py + 92 + i * 26));
    return { x: px, y: py, w: pw, h: ph };
  }

  function drawTitle(view) {
    const m = view.world.mission;
    ctx.fillStyle = 'rgba(10,14,24,0.45)';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 58px system-ui, sans-serif';
    ctx.fillText('SKYLINE COURIER', width / 2, height * 0.24);
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText('A little red aeroplane, a big valley, and the mail that has to get through.', width / 2, height * 0.24 + 36);
    // Mission cards.
    const cards = view.missions;
    const cw = Math.min(200, (width * 0.8) / 3 - 16);
    const cx0 = (width - (cw * 3 + 32)) / 2;
    const cy0 = height * 0.36;
    cards.forEach((mission, i) => {
      const x = cx0 + i * (cw + 16);
      const unlocked = i <= view.progress;
      ctx.fillStyle = unlocked ? 'rgba(8,12,20,0.85)' : 'rgba(8,12,20,0.45)';
      ctx.beginPath();
      ctx.roundRect(x, cy0, cw, 150, 10);
      ctx.fill();
      ctx.strokeStyle = view.selected === i ? '#ffd24a' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = view.selected === i ? 3 : 1;
      ctx.stroke();
      ctx.fillStyle = unlocked ? '#ffd24a' : '#777';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText(mission.name, x + cw / 2, cy0 + 30);
      ctx.fillStyle = unlocked ? '#ffffff' : '#999';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(mission.subtitle, x + cw / 2, cy0 + 52);
      const stars = view.stars[i] || 0;
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText(unlocked ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '🔒 Locked', x + cw / 2, cy0 + 86);
      ctx.fillStyle = '#cfe0f2';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`${mission.rings.length} rings · ${Math.floor(mission.timeLimit / 60)}:${String(mission.timeLimit % 60).padStart(2, '0')}`, x + cw / 2, cy0 + 112);
    });
    ctx.fillStyle = '#ffffff';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Click a sortie, or press 1–3, then Enter to fly.', width / 2, cy0 + 190);
    ctx.fillStyle = '#cfe0f2';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Arrows pitch & bank · W/S throttle · mouse drag steers · P pause · M mute', width / 2, cy0 + 216);
    if (view.best > 0) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`Best total score: ${view.best}`, width / 2, cy0 + 242);
    }
  }

  function drawBrief(view) {
    const m = view.world.mission;
    panel(m.name.toUpperCase(), [m.subtitle, '', ...wrapText(m.brief, 62), '', 'Press Enter or click to take off.'], '#ffd24a');
  }

  function wrapText(text, n) {
    const words = text.split(' ');
    const lines = [''];
    for (const w of words) {
      if ((lines[lines.length - 1] + ' ' + w).trim().length > n) lines.push(w);
      else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim();
    }
    return lines;
  }

  function drawEnd(view, screen) {
    const w = view.world;
    const lines = [];
    if (screen === SCREEN_LANDED) {
      lines.push(`All ${w.rings.length} rings flown — and the landing ${w.smoothLanding ? 'was silk-smooth' : 'held together'}.`);
      lines.push(`Landing bonus +${w.landBonus} pts · Time bonus included`);
      lines.push(`Score ${w.score} · ${'★'.repeat(view.starsEarned)}${'☆'.repeat(3 - view.starsEarned)}`);
      lines.push('');
      lines.push(w.missionIndex < 2 ? 'Press Enter for the next sortie.' : 'Campaign complete — press Enter for the title screen.');
    } else if (screen === SCREEN_CRASHED) {
      lines.push('The airframe gave out on the valley floor.');
      lines.push(`Score ${w.score} · Rings ${w.ringIndex}/${w.rings.length}`);
      lines.push('');
      lines.push('Press Enter to try the sortie again.');
    } else if (screen === SCREEN_TIMEOUT) {
      lines.push('The clock ran out before the mail got home.');
      lines.push(`Score ${w.score} · Rings ${w.ringIndex}/${w.rings.length}`);
      lines.push('');
      lines.push('Press Enter to try the sortie again.');
    } else if (screen === SCREEN_FUELOUT) {
      lines.push('The tank ran dry and the glide ran out of sky.');
      lines.push(`Score ${w.score} · Rings ${w.ringIndex}/${w.rings.length}`);
      lines.push('');
      lines.push('Press Enter to try the sortie again.');
    }
    const title = screen === SCREEN_LANDED ? 'SORTIE COMPLETE' : screen === SCREEN_CRASHED ? 'CRASHED' : screen === SCREEN_TIMEOUT ? 'OUT OF TIME' : 'OUT OF FUEL';
    const accent = screen === SCREEN_LANDED ? '#7ee2a0' : '#ff6b5e';
    panel(title, lines, accent);
  }

  function drawCampaign(view) {
    panel('CAMPAIGN COMPLETE', [
      'Three sorties flown, three landings walked away from.',
      `Total score ${view.totalScore} · Best ${view.best}`,
      '',
      'Press Enter to return to the title screen.',
    ], '#ffd24a');
  }

  // Main draw: sky, ground, objects, plane, weather, HUD, then the screen
  // overlay for whatever state the game is in.
  function draw(view, time) {
    const world = view.world;
    const screen = view.screen;
    const p = world.plane;
    const sky = SKIES[world.mission.sky];
    const cam = camera(p);
    drawSky(cam, sky, time);
    drawGround(cam, sky);
    drawObjects(cam, world, time, screen === SCREEN_PLAY || screen === SCREEN_PAUSED);
    if (world.mission.sky === 'dusk') drawRain(time);
    drawPlane(p, time);
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) drawHUD(world, time);
    if (screen === SCREEN_TITLE) drawTitle(view);
    else if (screen === SCREEN_BRIEF) drawBrief(view);
    else if (screen === SCREEN_PAUSED) panel('PAUSED', ['Press P or Esc to keep flying.', 'M toggles sound.'], '#ffd24a');
    else if (screen === SCREEN_LANDED || screen === SCREEN_CRASHED || screen === SCREEN_TIMEOUT || screen === SCREEN_FUELOUT) drawEnd(view, screen);
    else if (screen === SCREEN_CAMPAIGN) drawCampaign(view);
  }

  return { resize, setWorld, draw, project, camera, horizonY };
}
