import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { CFG, COLORS, SLOT_COLORS } from "../config.ts";
import { radiusOf, type SimEvent } from "../core/sim.ts";
import type { GameState, PowerKind } from "../core/types.ts";

const POWER_GLYPH: Record<PowerKind, string> = {
  boost: "»", shield: "◇", frenzy: "✦", magnet: "∞",
};
const POWER_COLOR: Record<PowerKind, number> = {
  boost: COLORS.cyan, shield: COLORS.violet, frenzy: COLORS.magenta, magnet: COLORS.gold,
};

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; color: number; }

export class World {
  cam = new Container();
  private grid = new Graphics();
  private slimeG = new Graphics();
  private powerG = new Graphics();
  private fxG = new Graphics();
  private orbs = new Map<string, { g: Graphics; label: Text }>();
  private particles: Particle[] = [];
  private shake = 0;
  zoom = 1;

  constructor(private app: Application) {
    app.stage.addChild(this.cam);
    this.drawGrid();
    this.cam.addChild(this.grid, this.slimeG, this.powerG, this.fxG);
  }

  private drawGrid() {
    const g = this.grid;
    g.rect(0, 0, CFG.world.w, CFG.world.h).fill(COLORS.bg);
    const step = 80;
    for (let x = 0; x <= CFG.world.w; x += step) g.moveTo(x, 0).lineTo(x, CFG.world.h);
    for (let y = 0; y <= CFG.world.h; y += step) g.moveTo(0, y).lineTo(CFG.world.w, y);
    g.stroke({ color: COLORS.gridLine, width: 1, alpha: 0.5 });
    g.rect(0, 0, CFG.world.w, CFG.world.h).stroke({ color: COLORS.violet, width: 6, alpha: 0.4 });
  }

  emit(e: SimEvent) {
    if (e.t === "pickup") this.burst(e.x, e.y, COLORS.green, 5, 1.6);
    else if (e.t === "eat") this.burst(e.x, e.y, e.color, 10, 3);
    else if (e.t === "death") { this.burst(e.x, e.y, COLORS.danger, 26, 5); this.shake = 14; }
    else if (e.t === "power") this.burst(e.x, e.y, POWER_COLOR[e.kind], 16, 3.5);
  }
  private burst(x: number, y: number, color: number, n: number, spd: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.4 + Math.random()) * spd * 60;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, max: 0.6, r: 2 + Math.random() * 3, color });
    }
  }

  private glowCircle(g: Graphics, x: number, y: number, r: number, color: number, alpha = 1) {
    g.circle(x, y, r * 2.1).fill({ color, alpha: 0.07 * alpha });
    g.circle(x, y, r * 1.5).fill({ color, alpha: 0.12 * alpha });
    g.circle(x, y, r).fill({ color, alpha: 0.95 * alpha });
  }

  draw(state: GameState, selfId: string, dt: number) {
    const self = state.players.get(selfId);

    // camera: follow self, zoom out as you grow
    if (self) {
      const targetZoom = Math.max(0.62, 1.12 - radiusOf(self.size) / 520);
      this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 3);
    }
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.shake *= 0.86;
    const cx = self ? self.x : CFG.world.w / 2, cy = self ? self.y : CFG.world.h / 2;
    this.cam.scale.set(this.zoom);
    this.cam.position.set(this.app.renderer.width / 2 - cx * this.zoom + sx, this.app.renderer.height / 2 - cy * this.zoom + sy);

    // slimes
    this.slimeG.clear();
    for (const s of state.slimes.values()) {
      this.slimeG.circle(s.x, s.y, 6).fill({ color: COLORS.green, alpha: 0.9 });
      this.slimeG.circle(s.x - 1.5, s.y - 1.5, 1.6).fill({ color: 0xffffff, alpha: 0.8 });
    }

    // powerups
    this.powerG.clear();
    this.powerG.removeChildren();
    const t = performance.now() / 400;
    for (const u of state.powerups.values()) {
      const col = POWER_COLOR[u.kind], pulse = 1 + Math.sin(t + u.id) * 0.12;
      this.powerG.circle(u.x, u.y, 18 * pulse).fill({ color: col, alpha: 0.14 });
      this.powerG.circle(u.x, u.y, 11).fill({ color: col, alpha: 0.9 });
      this.powerG.circle(u.x, u.y, 11).stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 });
      const g = new Text({ text: POWER_GLYPH[u.kind], style: GLYPH_STYLE });
      g.anchor.set(0.5); g.position.set(u.x, u.y); this.powerG.addChild(g);
    }

    // players (orbs)
    const seen = new Set<string>();
    const ordered = [...state.players.values()].sort((a, b) => a.size - b.size);
    for (const p of ordered) {
      seen.add(p.id);
      let o = this.orbs.get(p.id);
      if (!o) {
        const g = new Graphics();
        const label = new Text({ text: p.name, style: nameStyle() });
        label.anchor.set(0.5, 1);
        this.cam.addChild(g, label);
        this.orbs.set(p.id, (o = { g, label }));
      }
      const r = radiusOf(p.size), color = SLOT_COLORS[p.slot % SLOT_COLORS.length]!;
      o.g.clear();
      if (!p.alive) { o.g.visible = false; o.label.visible = false; continue; }
      o.g.visible = o.label.visible = true;
      const shield = p.fx.shield ? 1 : 0;
      this.glowCircle(o.g, p.x, p.y, r, color, p.id === selfId ? 1 : 0.92);
      o.g.circle(p.x, p.y, r).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
      if (shield) o.g.circle(p.x, p.y, r + 6 + Math.sin(t * 3) * 2).stroke({ color: COLORS.violet, width: 3, alpha: 0.8 });
      if (p.fx.boost) this.burstTrail(p.x - p.vx * 0.02, p.y - p.vy * 0.02, color);
      // eyes
      o.g.circle(p.x - r * 0.3, p.y - r * 0.15, Math.max(2, r * 0.16)).fill(0x0a0a12);
      o.g.circle(p.x + r * 0.3, p.y - r * 0.15, Math.max(2, r * 0.16)).fill(0x0a0a12);
      o.label.text = p.id === selfId ? `${p.name}` : p.name;
      o.label.position.set(p.x, p.y - r - 6);
      o.label.style.fill = p.id === selfId ? COLORS.ink : 0xaab0c8;
    }
    for (const [id, o] of this.orbs) if (!seen.has(id)) { o.g.destroy(); o.label.destroy(); this.orbs.delete(id); }

    // particles
    this.fxG.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt; if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      this.fxG.circle(p.x, p.y, p.r * (p.life / p.max)).fill({ color: p.color, alpha: p.life / p.max });
    }
  }
  private burstTrail(x: number, y: number, color: number) {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.3, max: 0.3, r: 5, color });
  }
}

const GLYPH_STYLE = new TextStyle({ fontFamily: "Space Grotesk, sans-serif", fontSize: 15, fontWeight: "700", fill: 0x0a0a12 });
function nameStyle() {
  return new TextStyle({ fontFamily: "Press Start 2P, monospace", fontSize: 8, fill: COLORS.ink });
}
