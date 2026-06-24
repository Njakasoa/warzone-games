/** Tunables + palette. One place to balance the game. */
export const CFG = {
  world: { w: 2400, h: 2400 },
  matchSeconds: 120,
  player: {
    baseSpeed: 320, // px/s
    startSize: 14,
    pickupRadius: 26,
  },
  slime: {
    target: 140, // how many slimes to keep on the map
    size: 1.4, // size gained per slime
    xp: 4,
  },
  bots: { default: 7, speed: 300, retargetEvery: 1.2 },
  combat: {
    // overlap eat: bigger transfers from smaller when centers are close
    eatRatio: 1.18, // must be this much bigger to eat
    transferRate: 0.9,
  },
  level: { base: 30, growth: 1.55 }, // xp to reach next level
  powerup: { target: 3, respawn: 9, duration: 7 },
} as const;

export const COLORS = {
  bg: 0x0a0a12,
  grid: 0x161622,
  gridLine: 0x20203a,
  magenta: 0xff3d77,
  violet: 0x8a7dff,
  cyan: 0x2ee6ff,
  green: 0x5fe3a1,
  gold: 0xf9c74f,
  ink: 0xe8e8f5,
  danger: 0xff5470,
} as const;

// Stable color per player slot.
export const SLOT_COLORS = [
  COLORS.magenta,
  COLORS.cyan,
  COLORS.green,
  COLORS.gold,
  COLORS.violet,
  0xff8d4d,
  0x4d9bff,
  0xff4dd2,
  0x9bff4d,
];
