// Keyboard + pointer input: the stick (pitch/roll), the throttle lever, and
// the action buttons (confirm, pause, mute, restart). Pointer drag on the
// canvas steers like a stick; clicks are reported with their position.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_RESTART = 8;

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let pointer = null; // { x, y } in canvas pixels while dragging, else null
  let click = null; // { x, y } of the latest click, consumed by takeClick()
  let pointerDown = false;

  function onKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'Enter') actions |= ACTION_CONFIRM;
    if (e.code === 'KeyP' || e.code === 'Escape') actions |= ACTION_PAUSE;
    if (e.code === 'KeyM') actions |= ACTION_MUTE;
    if (e.code === 'KeyR') actions |= ACTION_RESTART;
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }
  function onPointerDown(e) {
    pointerDown = true;
    pointer = { x: e.offsetX, y: e.offsetY };
  }
  function onPointerMove(e) {
    if (pointerDown) pointer = { x: e.offsetX, y: e.offsetY };
  }
  function onPointerUp(e) {
    pointerDown = false;
    pointer = null;
    click = { x: e.offsetX, y: e.offsetY };
  }
  function onBlur() {
    keys.clear();
    pointerDown = false;
    pointer = null;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('blur', onBlur);

  // Stick deflection in [-1, 1] for pitch (up is positive) and roll.
  // Arrows fly the stick; A/D bank as well. W/S are the throttle, not pitch.
  function stick() {
    let pitch = 0;
    let roll = 0;
    if (keys.has('ArrowUp')) pitch += 1;
    if (keys.has('ArrowDown')) pitch -= 1;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) roll -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) roll += 1;
    if (pointer) {
      const rect = canvas.getBoundingClientRect();
      const nx = (pointer.x / rect.width) * 2 - 1;
      const ny = (pointer.y / rect.height) * 2 - 1;
      roll += nx * 1.4;
      pitch += -ny * 1.2;
    }
    return {
      pitch: Math.max(-1, Math.min(1, pitch)),
      roll: Math.max(-1, Math.min(1, roll)),
    };
  }

  // Throttle lever: W/Shift push it up, S/Ctrl pull it back.
  // The lever is held in main.js; this reports the nudge each frame.
  function throttleNudge() {
    let nudge = 0;
    if (keys.has('KeyW') || keys.has('ShiftLeft') || keys.has('ShiftRight')) nudge += 1;
    if (keys.has('KeyS') || keys.has('ControlLeft') || keys.has('ControlRight')) nudge -= 1;
    return nudge;
  }

  function takeActions() {
    const taken = actions;
    actions = 0;
    return taken;
  }

  function takeClick() {
    const taken = click;
    click = null;
    return taken;
  }

  function digitPressed() {
    for (const code of ['Digit1', 'Digit2', 'Digit3']) {
      if (keys.has(code)) return Number(code.slice(-1));
    }
    return 0;
  }

  return { stick, throttleNudge, takeActions, takeClick, digitPressed };
}
