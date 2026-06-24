import { CFG } from "../config.ts";
import { createState, makePlayer, step, type SimEvent } from "../core/sim.ts";
import type { GameState, Input, Player } from "../core/types.ts";

/**
 * The game loop talks to a NetGame and never needs to know whether it runs
 * solo or online. Solo + the online "host" both simulate; online "clients"
 * just render authoritative snapshots. Swapping multiplayer in is a transport
 * swap, nothing else.
 */
export interface NetGame {
  readonly selfId: string;
  state: GameState;
  isSimulating: boolean; // solo or host
  pushInput(input: Input): void;
  update(dt: number, events: SimEvent[]): void;
  stop(): void;
}

function spawnRing(n: number): Array<{ x: number; y: number }> {
  const cx = CFG.world.w / 2, cy = CFG.world.h / 2, r = 520;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

// ── Solo: human + bots, simulated locally ──────────────────
export class LocalTransport implements NetGame {
  readonly selfId = "you";
  state: GameState;
  isSimulating = true;
  private input: Input = { dx: 0, dy: 0, dash: false };

  constructor(name: string, bots: number, seed = (Math.random() * 1e9) | 0) {
    const pos = spawnRing(bots + 1);
    const players: Player[] = [
      makePlayer(this.selfId, name, 0, false, pos[0]!.x, pos[0]!.y),
    ];
    for (let i = 0; i < bots; i++) {
      players.push(makePlayer(`bot${i}`, BOT_NAMES[i % BOT_NAMES.length]!, i + 1, true, pos[i + 1]!.x, pos[i + 1]!.y));
    }
    this.state = createState(seed, players);
  }
  pushInput(i: Input) { this.input = i; }
  update(dt: number, events: SimEvent[]) {
    const inputs = new Map<string, Input>([[this.selfId, this.input]]);
    step(this.state, dt, inputs, events);
  }
  stop() {}
}

export const BOT_NAMES = [
  "Vex", "Nyx", "Kilo", "Rook", "Mara", "Zenn", "Bolt", "Onyx", "Pyra", "Drift",
];

// ── Online: host-authoritative over core-api /rt ───────────
type Msg =
  | { k: "input"; from: string; input: Input }
  | { k: "snap"; s: SnapState }
  | { k: "hello"; name: string };

interface SnapState {
  time: number;
  over: boolean;
  players: Array<Pick<Player, "id" | "name" | "slot" | "x" | "y" | "size" | "level" | "kills" | "alive"> & { fx: string[] }>;
  slimes: Array<[number, number, number, number]>; // id,x,y,kind
  powerups: Array<[number, number, number, string]>;
}

export class RealtimeTransport implements NetGame {
  selfId: string;
  state: GameState;
  isSimulating = false; // becomes true if we are host
  private ws: WebSocket;
  private room: string;
  private input: Input = { dx: 0, dy: 0, dash: false };
  private remoteInputs = new Map<string, Input>();
  private snapAccum = 0;
  private inputAccum = 0;
  onPlayers?: (n: number) => void;

  constructor(opts: { ws: WebSocket; room: string; selfId: string; name: string; host: boolean; seed: number }) {
    this.ws = opts.ws;
    this.room = opts.room;
    this.selfId = opts.selfId;
    this.isSimulating = opts.host;
    const players: Player[] = [];
    if (opts.host) {
      const pos = spawnRing(8);
      players.push(makePlayer(opts.selfId, opts.name, 0, false, pos[0]!.x, pos[0]!.y));
    }
    this.state = createState(opts.seed, players);

    this.ws.addEventListener("message", (e) => this.onMessage(String(e.data)));
    this.send({ k: "hello", name: opts.name });
  }

  private send(m: Msg) {
    this.ws.send(JSON.stringify({ type: "broadcast", room: this.room, data: m }));
  }

  private onMessage(raw: string) {
    let env: { type?: string; from?: string; data?: Msg; count?: number };
    try { env = JSON.parse(raw); } catch { return; }
    if (env.type === "presence" && this.onPlayers) this.onPlayers(env.count ?? 1);
    if (env.type !== "message" || !env.data) return;
    const m = env.data;
    if (m.k === "input" && this.isSimulating) {
      this.remoteInputs.set(m.from, m.input);
      if (!this.state.players.has(m.from)) {
        const r = spawnRing(8)[(this.state.players.size) % 8]!;
        this.state.players.set(m.from, makePlayer(m.from, "P" + this.state.players.size, this.state.players.size, false, r.x, r.y));
      }
    } else if (m.k === "snap" && !this.isSimulating) {
      this.applySnap(m.s);
    }
  }

  pushInput(i: Input) { this.input = i; }

  update(dt: number, events: SimEvent[]) {
    if (this.isSimulating) {
      const inputs = new Map<string, Input>(this.remoteInputs);
      inputs.set(this.selfId, this.input);
      step(this.state, dt, inputs, events);
      this.snapAccum += dt;
      if (this.snapAccum >= 1 / 15) { this.snapAccum = 0; this.send({ k: "snap", s: this.snapshot() }); }
    } else {
      this.inputAccum += dt;
      if (this.inputAccum >= 1 / 30) { this.inputAccum = 0; this.send({ k: "input", from: this.selfId, input: this.input }); }
    }
  }

  private snapshot(): SnapState {
    return {
      time: this.state.time, over: this.state.over,
      players: [...this.state.players.values()].map((p) => ({
        id: p.id, name: p.name, slot: p.slot, x: Math.round(p.x), y: Math.round(p.y),
        size: Math.round(p.size * 10) / 10, level: p.level, kills: p.kills, alive: p.alive,
        fx: Object.keys(p.fx),
      })),
      slimes: [...this.state.slimes.values()].map((s) => [s.id, Math.round(s.x), Math.round(s.y), s.kind] as [number, number, number, number]),
      powerups: [...this.state.powerups.values()].map((u) => [u.id, Math.round(u.x), Math.round(u.y), u.kind] as [number, number, number, string]),
    };
  }

  private applySnap(s: SnapState) {
    this.state.time = s.time; this.state.over = s.over;
    const seen = new Set<string>();
    for (const ps of s.players) {
      seen.add(ps.id);
      let p = this.state.players.get(ps.id);
      if (!p) { p = makePlayer(ps.id, ps.name, ps.slot, ps.id !== this.selfId, ps.x, ps.y); this.state.players.set(ps.id, p); }
      // lerp toward authoritative pos for smoothness
      p.x += (ps.x - p.x) * 0.4; p.y += (ps.y - p.y) * 0.4;
      p.size = ps.size; p.level = ps.level; p.kills = ps.kills; p.alive = ps.alive; p.name = ps.name;
      p.fx = Object.fromEntries(ps.fx.map((k) => [k, 1]));
    }
    for (const id of [...this.state.players.keys()]) if (!seen.has(id)) this.state.players.delete(id);
    this.state.slimes.clear();
    for (const [id, x, y, kind] of s.slimes) this.state.slimes.set(id, { id, x, y, kind });
    this.state.powerups.clear();
    for (const [id, x, y, kind] of s.powerups) this.state.powerups.set(id, { id, x, y, kind: kind as never });
  }

  stop() { try { this.ws.close(); } catch {} }
}
