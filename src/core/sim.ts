import { CFG } from "../config.ts";
import { RNG } from "./rng.ts";
import { UPGRADES } from "./upgrades.ts";
import type {
  GameState,
  Input,
  Player,
  PowerKind,
  PowerUp,
  Slime,
} from "./types.ts";

export type SimEvent =
  | { t: "pickup"; x: number; y: number }
  | { t: "eat"; x: number; y: number; color: number }
  | { t: "death"; x: number; y: number; color: number }
  | { t: "level"; id: string }
  | { t: "power"; x: number; y: number; kind: PowerKind };

export function radiusOf(size: number): number {
  return 9 + Math.sqrt(Math.max(0, size)) * 3.4;
}
export function xpToNext(level: number): number {
  return Math.round(CFG.level.base * Math.pow(CFG.level.growth, level - 1));
}

let slimeSeq = 1;
let powSeq = 1;
const POWERS: PowerKind[] = ["boost", "shield", "frenzy", "magnet"];

export function makePlayer(
  id: string,
  name: string,
  slot: number,
  bot: boolean,
  x: number,
  y: number,
): Player {
  return {
    id, name, slot, bot, alive: true, x, y, vx: 0, vy: 0,
    size: CFG.player.startSize, xp: 0, level: 1,
    speedMul: 1, pickupBonus: 0, greed: 0, armor: 0,
    fx: {}, dashCd: 0, pendingUpgrades: 0, kills: 0,
  };
}

export function createState(seed: number, players: Player[]): GameState {
  const rng = new RNG(seed);
  const st: GameState = {
    seed, time: 0,
    players: new Map(), slimes: new Map(), powerups: new Map(), over: false,
  };
  for (const p of players) st.players.set(p.id, p);
  while (st.slimes.size < CFG.slime.target) spawnSlime(st, rng);
  while (st.powerups.size < CFG.powerup.target) spawnPower(st, rng);
  return st;
}

function spawnSlime(st: GameState, rng: RNG) {
  const s: Slime = {
    id: slimeSeq++,
    x: rng.range(40, CFG.world.w - 40),
    y: rng.range(40, CFG.world.h - 40),
    kind: rng.int(0, 5),
  };
  st.slimes.set(s.id, s);
}
function spawnPower(st: GameState, rng: RNG) {
  const p: PowerUp = {
    id: powSeq++,
    x: rng.range(80, CFG.world.w - 80),
    y: rng.range(80, CFG.world.h - 80),
    kind: rng.pick(POWERS),
  };
  st.powerups.set(p.id, p);
}

export function speedFactor(size: number): number {
  return Math.max(0.55, 1 - (size - CFG.player.startSize) / 900);
}

/** Simple bot AI: chase nearest smaller player / slime, flee bigger ones. */
function botInput(st: GameState, b: Player): Input {
  let fleeX = 0, fleeY = 0, seekX = 0, seekY = 0, best = Infinity;
  for (const p of st.players.values()) {
    if (p === b || !p.alive) continue;
    const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (p.size > b.size * 1.1 && d < 380) {
      fleeX -= dx / d; fleeY -= dy / d;
    } else if (b.size > p.size * CFG.combat.eatRatio && d < 520 && d < best) {
      best = d; seekX = dx / d; seekY = dy / d;
    }
  }
  if (fleeX || fleeY) return { dx: fleeX, dy: fleeY, dash: best < 90 };
  if (seekX || seekY) return { dx: seekX, dy: seekY, dash: false };
  // wander toward nearest slime
  let sx = 0, sy = 0, sd = Infinity;
  for (const s of st.slimes.values()) {
    const dx = s.x - b.x, dy = s.y - b.y, d = dx * dx + dy * dy;
    if (d < sd) { sd = d; sx = dx; sy = dy; }
  }
  const n = Math.hypot(sx, sy) || 1;
  return { dx: sx / n, dy: sy / n, dash: false };
}

export function step(
  st: GameState,
  dt: number,
  inputs: Map<string, Input>,
  events: SimEvent[],
): void {
  if (st.over) return;
  const rng = new RNG((st.seed ^ Math.floor(st.time * 60)) >>> 0);
  st.time += dt;

  // ── movement + effects ──
  for (const p of st.players.values()) {
    if (!p.alive) continue;
    for (const k of Object.keys(p.fx)) {
      if (k === "regen" || k === "dashFast") continue; // permanent-ish
      p.fx[k]! -= dt;
      if (p.fx[k]! <= 0) delete p.fx[k];
    }
    if (p.fx.regen) p.size += p.fx.regen * dt;

    const inp = p.bot ? botInput(st, p) : inputs.get(p.id) ?? { dx: 0, dy: 0, dash: false };
    let dx = inp.dx, dy = inp.dy;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }

    const boost = p.fx.boost ? 1.55 : 1;
    const spd = CFG.player.baseSpeed * p.speedMul * speedFactor(p.size) * boost;
    p.vx += (dx * spd - p.vx) * Math.min(1, dt * 10);
    p.vy += (dy * spd - p.vy) * Math.min(1, dt * 10);

    if (p.dashCd > 0) p.dashCd -= dt * (1 + (p.fx.dashFast ?? 0));
    if (inp.dash && p.dashCd <= 0 && m > 0.1) {
      p.vx += dx * 520; p.vy += dy * 520;
      p.dashCd = 2.6;
      p.fx.dashTrail = 0.25;
    }

    p.x = Math.max(20, Math.min(CFG.world.w - 20, p.x + p.vx * dt));
    p.y = Math.max(20, Math.min(CFG.world.h - 20, p.y + p.vy * dt));

    // level ups
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      events.push({ t: "level", id: p.id });
      if (p.bot) UPGRADES[rng.int(0, UPGRADES.length - 1)]!.apply(p);
      else p.pendingUpgrades++;
    }
  }

  // ── slime pickups + magnet ──
  for (const p of st.players.values()) {
    if (!p.alive) continue;
    const reach = (radiusOf(p.size) + CFG.player.pickupRadius) * (1 + p.pickupBonus + (p.fx.magnet ? 0.8 : 0));
    const magnet = p.fx.magnet ? 1 : 0;
    for (const s of st.slimes.values()) {
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
      if (magnet && d < reach * 2.4) {
        s.x += (dx / (d || 1)) * 240 * dt;
        s.y += (dy / (d || 1)) * 240 * dt;
      }
      if (d < reach) {
        st.slimes.delete(s.id);
        p.size += CFG.slime.size * (1 + p.greed);
        p.xp += CFG.slime.xp;
        events.push({ t: "pickup", x: s.x, y: s.y });
      }
    }
  }
  while (st.slimes.size < CFG.slime.target) spawnSlime(st, rng);

  // ── powerups ──
  for (const p of st.players.values()) {
    if (!p.alive) continue;
    const reach = radiusOf(p.size) + 24;
    for (const u of st.powerups.values()) {
      if (Math.hypot(p.x - u.x, p.y - u.y) < reach) {
        st.powerups.delete(u.id);
        p.fx[u.kind] = CFG.powerup.duration;
        events.push({ t: "power", x: u.x, y: u.y, kind: u.kind });
      }
    }
  }
  if (st.powerups.size < CFG.powerup.target && rng.next() < dt / CFG.powerup.respawn) {
    spawnPower(st, rng);
  }

  // ── combat (eat) ──
  const list = [...st.players.values()].filter((p) => p.alive);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > (radiusOf(a.size) + radiusOf(b.size)) * 0.62) continue;
      const big = a.size >= b.size ? a : b;
      const small = big === a ? b : a;
      if (small.fx.shield) continue;
      const ratio = big.fx.frenzy ? 1.05 : CFG.combat.eatRatio;
      if (big.size < small.size * ratio) continue;
      const amt = small.size * CFG.combat.transferRate * dt * (1 - small.armor);
      small.size -= amt;
      big.size += amt * 0.55;
      if (small.size <= CFG.player.startSize * 0.6) {
        killPlayer(st, small, big, events, rng);
      }
    }
  }

  // ── win / end ──
  const alive = [...st.players.values()].filter((p) => p.alive);
  if (st.time >= CFG.matchSeconds || alive.length <= 1) st.over = true;
}

function killPlayer(st: GameState, victim: Player, killer: Player, events: SimEvent[], rng: RNG) {
  killer.kills++;
  events.push({ t: "death", x: victim.x, y: victim.y, color: 0xffffff });
  if (victim.bot) {
    // respawn bots so the arena stays lively
    victim.size = CFG.player.startSize;
    victim.x = rng.range(60, CFG.world.w - 60);
    victim.y = rng.range(60, CFG.world.h - 60);
    victim.vx = victim.vy = 0;
    victim.fx.shield = 2;
  } else {
    // human respawns smaller with brief shield (keeps the match going)
    victim.size = CFG.player.startSize;
    victim.x = rng.range(60, CFG.world.w - 60);
    victim.y = rng.range(60, CFG.world.h - 60);
    victim.vx = victim.vy = 0;
    victim.fx.shield = 3;
  }
}

export function ranking(st: GameState): Player[] {
  return [...st.players.values()].sort((a, b) => b.size - a.size);
}
