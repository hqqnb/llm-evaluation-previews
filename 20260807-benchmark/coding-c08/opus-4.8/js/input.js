// input.js — keyboard, mouse, pointer lock
export const Input = {
  keys: {}, justPressed: {}, mouseDX: 0, mouseDY: 0,
  mouseDown: false, rightDown: false, wheel: 0, locked: false,
  sensitivity: 1.0,
  _canvas: null, _onLockChange: null,
};

export function initInput(canvas, onLockChange) {
  Input._canvas = canvas;
  Input._onLockChange = onLockChange;

  window.addEventListener('keydown', e => {
    const k = e.code;
    if (!Input.keys[k]) Input.justPressed[k] = true;
    Input.keys[k] = true;
    if (['Tab', 'Space', 'KeyB'].includes(k) || k.startsWith('Arrow')) {
      if (Input.locked || k === 'Tab') e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => { Input.keys[e.code] = false; });

  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) Input.mouseDown = true;
    if (e.button === 2) Input.rightDown = true;
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) Input.mouseDown = false;
    if (e.button === 2) Input.rightDown = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('wheel', e => { Input.wheel += Math.sign(e.deltaY); }, { passive: true });

  document.addEventListener('mousemove', e => {
    if (Input.locked) {
      Input.mouseDX += e.movementX * 0.0022 * Input.sensitivity;
      Input.mouseDY += e.movementY * 0.0022 * Input.sensitivity;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    Input.locked = document.pointerLockElement === canvas;
    if (!Input.locked) { Input.mouseDown = false; Input.rightDown = false; }
    if (Input._onLockChange) Input._onLockChange(Input.locked);
  });
}
export function requestLock() {
  if (Input._canvas && document.pointerLockElement !== Input._canvas) {
    Input._canvas.requestPointerLock();
  }
}
export function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

export function pressed(code) { return !!Input.justPressed[code]; }
export function down(code) { return !!Input.keys[code]; }
// consume per-frame transient input
export function endFrameInput() {
  Input.justPressed = {}; Input.mouseDX = 0; Input.mouseDY = 0; Input.wheel = 0;
}
