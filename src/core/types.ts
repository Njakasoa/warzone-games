export interface Vec {
  x: number;
  y: number;
}

/** Per-tick intent for one player. This is all the network has to carry. */
export interface Input {
  dx: number; // -1..1
  dy: number; // -1..1
  dash: boolean;
}

export interface Player {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number; // "mass" — radius derives from this
  xp: number;
  level: number;
  // upgrade-driven stats (multipliers/bonuses)
  speedMul: number;
  pickupBonus: number;
  greed: number; // extra size per slime
  armor: number; // 0..0.8 damage reduction when eaten
  // transient effects { type -> remaining seconds }
  fx: Record<string, number>;
  dashCd: number;
  // pending level-up choices (for the local human)
  pendingUpgrades: number;
  kills: number;
}

export interface Slime {
  id: number;
  x: number;
  y: number;
  kind: number; // sprite variant
}

export type PowerKind = "boost" | "shield" | "frenzy" | "magnet";
export interface PowerUp {
  id: number;
  x: number;
  y: number;
  kind: PowerKind;
}

export interface GameState {
  seed: number;
  time: number; // seconds elapsed
  players: Map<string, Player>;
  slimes: Map<number, Slime>;
  powerups: Map<number, PowerUp>;
  over: boolean;
}
