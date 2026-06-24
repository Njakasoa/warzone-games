import type { Input } from "./core/types.ts";

/** Keyboard + pointer steering. Returns a fresh Input each frame. */
export class Controls {
  private keys = new Set<string>();
  private pointer: { x: number; y: number; active: boolean } = { x: 0, y: 0, active: false };
  private dashQueued = false;

  constructor(el: HTMLElement) {
    addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.code === "Space") { this.dashQueued = true; e.preventDefault(); }
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    el.addEventListener("pointermove", (e) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; });
    el.addEventListener("pointerdown", (e) => { this.pointer.active = true; this.pointer.x = e.clientX; this.pointer.y = e.clientY; });
    el.addEventListener("pointerup", () => (this.pointer.active = false));
    addEventListener("blur", () => this.keys.clear());
  }

  sample(): Input {
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k.has("a") || k.has("arrowleft")) dx -= 1;
    if (k.has("d") || k.has("arrowright")) dx += 1;
    if (k.has("w") || k.has("arrowup")) dy -= 1;
    if (k.has("s") || k.has("arrowdown")) dy += 1;

    // pointer steering when no keys pressed (mobile / mouse)
    if (dx === 0 && dy === 0 && this.pointer.active) {
      const ex = this.pointer.x - innerWidth / 2;
      const ey = this.pointer.y - innerHeight / 2;
      const d = Math.hypot(ex, ey);
      if (d > 24) { dx = ex / d; dy = ey / d; }
    }
    const dash = this.dashQueued;
    this.dashQueued = false;
    return { dx, dy, dash };
  }
}
