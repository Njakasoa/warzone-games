import type { Player } from "./types.ts";

export interface Upgrade {
  id: string;
  name: string;
  desc: string;
  icon: string;
  apply: (p: Player) => void;
}

/** Level-up upgrade catalog (roguelite cards). Stacks across a match. */
export const UPGRADES: Upgrade[] = [
  {
    id: "swift",
    name: "Swiftness",
    desc: "+12% move speed",
    icon: "⚡",
    apply: (p) => (p.speedMul += 0.12),
  },
  {
    id: "magnet",
    name: "Magnet",
    desc: "+40% pickup range",
    icon: "🧲",
    apply: (p) => (p.pickupBonus += 0.4),
  },
  {
    id: "greed",
    name: "Greed",
    desc: "+60% size per slime",
    icon: "💎",
    apply: (p) => (p.greed += 0.6),
  },
  {
    id: "bulwark",
    name: "Bulwark",
    desc: "Lose 18% less when bitten",
    icon: "🛡️",
    apply: (p) => (p.armor = Math.min(0.8, p.armor + 0.18)),
  },
  {
    id: "engine",
    name: "Overdrive",
    desc: "Dash recharges 25% faster",
    icon: "🚀",
    apply: (p) => (p.fx.dashFast = (p.fx.dashFast ?? 0) + 0.25),
  },
  {
    id: "vigor",
    name: "Vigor",
    desc: "Slowly grow over time",
    icon: "🌱",
    apply: (p) => (p.fx.regen = (p.fx.regen ?? 0) + 0.5),
  },
];

/** Deterministic 3-card offer from a roll in [0,1) per slot. */
export function offer(roll: () => number): Upgrade[] {
  const pool = [...UPGRADES];
  const out: Upgrade[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    out.push(pool.splice(Math.floor(roll() * pool.length), 1)[0]!);
  }
  return out;
}
