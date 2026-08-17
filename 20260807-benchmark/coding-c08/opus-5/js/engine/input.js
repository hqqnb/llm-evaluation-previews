// ============================================================================
// engine/input.js — pointer-lock mouse look + keyboard bindings.
//
// Keys are read as physical codes so WASD works on any layout.  UI modules can
// claim keys first via `input.claim(fn)`; anything they consume never reaches
// the player command.
// ============================================================================

import { clamp } from '../core/util.js';

export const BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'ControlLeft', walk: 'ShiftLeft', sprint: 'AltLeft',
  reload: 'KeyR', use: 'KeyE', drop: 'KeyG', buy: 'KeyB', inspect: 'KeyF',
  scoreboard: 'Tab', mapinfo: 'KeyM', pause: 'Escape', lastWeapon: 'KeyQ',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5',
};

export class Input {
  constructor(target, cfg) {
    this.target = target;
    this.cfg = cfg;
    this.keys = new Set();
    this.justPressed = new Set();
    this.justReleased = new Set();
    this.mouse = { left: false, right: false, middle: false };
    this.mouseJust = { left: false, right: false };
    this.dx = 0; this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.claims = [];
    this.enabled = true;
    this._bound = false;
    this._handlers = {};
  }

  /** UI modules register a handler that returns true when it consumed the key. */
  claim(fn) { this.claims.push(fn); return () => { this.claims = this.claims.filter((f) => f !== fn); }; }

  bind() {
    if (this._bound) return;
    this._bound = true;
    const h = this._handlers;
    h.keydown = (e) => {
      if (e.code === 'Tab' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (e.repeat) return;
      for (const c of this.claims) if (c(e, true)) return;
      this.keys.add(e.code);
      this.justPressed.add(e.code);
    };
    h.keyup = (e) => {
      for (const c of this.claims) if (c(e, false)) return;
      this.keys.delete(e.code);
      this.justReleased.add(e.code);
    };
    h.mousedown = (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouseJust.left = true; }
      if (e.button === 1) this.mouse.middle = true;
      if (e.button === 2) { this.mouse.right = true; this.mouseJust.right = true; }
    };
    h.mouseup = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 1) this.mouse.middle = false;
      if (e.button === 2) this.mouse.right = false;
    };
    h.mousemove = (e) => {
      if (!this.locked || !this.enabled) return;
      const s = this.cfg.sensitivity * 0.00062;
      this.dx += e.movementX * s;
      this.dy += e.movementY * s * (this.cfg.invertY ? -1 : 1);
    };
    h.wheel = (e) => { if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } };
    h.lockchange = () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; this.onUnlock?.(); }
    };
    h.contextmenu = (e) => { if (this.locked) e.preventDefault(); };
    h.blur = () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; };

    window.addEventListener('keydown', h.keydown, { passive: false });
    window.addEventListener('keyup', h.keyup);
    window.addEventListener('mousedown', h.mousedown);
    window.addEventListener('mouseup', h.mouseup);
    window.addEventListener('mousemove', h.mousemove);
    window.addEventListener('wheel', h.wheel, { passive: false });
    window.addEventListener('blur', h.blur);
    document.addEventListener('pointerlockchange', h.lockchange);
    document.addEventListener('contextmenu', h.contextmenu);
  }

  unbind() {
    if (!this._bound) return;
    const h = this._handlers;
    window.removeEventListener('keydown', h.keydown);
    window.removeEventListener('keyup', h.keyup);
    window.removeEventListener('mousedown', h.mousedown);
    window.removeEventListener('mouseup', h.mouseup);
    window.removeEventListener('mousemove', h.mousemove);
    window.removeEventListener('wheel', h.wheel);
    window.removeEventListener('blur', h.blur);
    document.removeEventListener('pointerlockchange', h.lockchange);
    document.removeEventListener('contextmenu', h.contextmenu);
    this._bound = false;
  }

  lock() { try { this.target.requestPointerLock?.(); } catch (e) { /* user gesture required */ } }
  unlock() { try { document.exitPointerLock?.(); } catch (e) { /* ignore */ } }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }
  released(code) { return this.justReleased.has(code); }

  /** Translate the current key state into an actor command. */
  fillCmd(cmd, actor) {
    const B = BINDINGS;
    cmd.forward = (this.down(B.forward) ? 1 : 0) + (this.down(B.back) ? -1 : 0);
    cmd.right = (this.down(B.right) ? 1 : 0) + (this.down(B.left) ? -1 : 0);
    cmd.jump = this.down(B.jump);
    cmd.crouch = this.down(B.crouch);
    cmd.walk = this.down(B.walk);
    cmd.sprint = this.down(B.sprint);
    cmd.attack = this.mouse.left;
    cmd.attack2 = this.mouse.right;
    cmd.use = this.down(B.use);
    cmd.reload = this.pressed(B.reload);
    cmd.drop = this.pressed(B.drop);
    cmd.inspect = this.pressed(B.inspect);
    if (this.pressed(B.slot1)) cmd.switchTo = 'primary';
    else if (this.pressed(B.slot2)) cmd.switchTo = 'secondary';
    else if (this.pressed(B.slot3)) cmd.switchTo = 'knife';
    else if (this.pressed(B.slot4)) cmd.switchTo = 'grenade';
    else if (this.pressed(B.slot5)) cmd.switchTo = 'bomb';
    else if (this.pressed(B.lastWeapon)) cmd.switchTo = actor?.lastSlot || 'secondary';
    return cmd;
  }

  /** Mouse delta since the last call (radians). */
  consumeLook() {
    const dx = this.dx, dy = this.dy;
    this.dx = 0; this.dy = 0;
    return { dx, dy };
  }

  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
    this.mouseJust.left = false;
    this.mouseJust.right = false;
  }
}


