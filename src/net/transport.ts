import { CFG } from "../config.ts";
import { createState, makePlayer, speedFactor, step, type SimEvent } from "../core/sim.ts";
import { applyUpgradeById } from "../core/upgrades.ts";
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
  /** Apply a level-up upgrade. Solo/host apply locally; clients send it to the host. */
  chooseUpgrade(id: string): void;
  /** Start a fresh match keeping the same players/room (host-driven online). */
  restart(): void;
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
  chooseUpgrade() {} // solo applies upgrades locally (see game.ts)
  restart() {}       // solo restarts by recreating the transport (see game.ts)
  stop() {}
}

export const BOT_NAMES = [
  "Vex", "Nyx", "Kilo", "Rook", "Mara", "Zenn", "Bolt", "Onyx", "Pyra", "Drift",
];

// ── Online: host-authoritative ─────────────────────────────
/**
 * The wire transport under RealtimeTransport. `WsChannel` relays everything
 * through the server; `RtcChannel` (see webrtc.ts) carries game traffic peer
 * to peer. Swapping one for the other changes nothing in the game logic.
 */
export interface NetChannel {
  readonly selfId: string;
  send(data: unknown): void;                       // host → all clients, client → host (fast path)
  sendReliable(data: unknown): void;               // same routing, guaranteed delivery (rare events)
  onMessage(cb: (from: string, data: unknown) => void): void;
  onPeers(cb: (n: number) => void): void;
  onDown(cb: () => void): void; // fired when the link drops unexpectedly (for reconnect)
  close(): void;
}

type Msg =
  | { k: "input"; input: Input }
  | { k: "snap"; s: SnapState }
  | { k: "upgrade"; id: string }
  | { k: "hello"; name: string }
  | { k: "restart" };

interface SnapState {
  time: number;
  over: boolean;
  players: Array<Pick<Player, "id" | "name" | "slot" | "x" | "y" | "size" | "level" | "xp" | "kills" | "alive"> & { fx: string[] }>;
  slimes: Array<[number, number, number, number]>; // id,x,y,kind
  powerups: Array<[number, number, number, string]>;
  events: SimEvent[]; // combat/powerup feedback since the last snapshot (no slime pickups)
}

export class RealtimeTransport implements NetGame {
  selfId: string;
  state: GameState;
  isSimulating = false; // becomes true if we are host
  private channel: NetChannel;
  private input: Input = { dx: 0, dy: 0, dash: false };
  private remoteInputs = new Map<string, Input>();
  private snapAccum = 0;
  private inputAccum = 0;
  // Latest authoritative position per player, applied gradually in update():
  // remote orbs interpolate toward it, our own orb (locally predicted) is
  // gently corrected toward it. This is what keeps clients smooth between the
  // host's snapshots instead of freezing then jumping.
  private targets = new Map<string, { x: number; y: number }>();
  private pendingNames = new Map<string, string>(); // host: client id → chosen callsign
  private outEvents: SimEvent[] = []; // host: events queued for the next snapshot
  private inEvents: SimEvent[] = [];  // client: events from snapshots, drained each frame
  private lastSnap = 0; private gotSnap = false; private lostFired = false;
  onPlayers?: (n: number) => void;
  onLost?: () => void;    // client: host stopped sending (left mid-match)
  onRestart?: () => void; // client: host started a rematch in this room

  constructor(opts: { channel: NetChannel; selfId: string; name: string; host: boolean; seed: number }) {
    this.channel = opts.channel;
    this.selfId = opts.selfId;
    this.isSimulating = opts.host;
    const players: Player[] = [];
    if (opts.host) {
      const pos = spawnRing(8);
      players.push(makePlayer(opts.selfId, opts.name, 0, false, pos[0]!.x, pos[0]!.y));
    }
    this.state = createState(opts.seed, players);

    this.channel.onMessage((from, data) => this.onMessage(from, data as Msg));
    this.channel.onPeers((n) => this.onPlayers?.(n));

    // Clients tell the host their callsign (reliably) so we don't show "P1" etc.
    if (!opts.host) this.channel.sendReliable({ k: "hello", name: opts.name });
  }

  private send(m: Msg) { this.channel.send(m); }

  private onMessage(from: string, m: Msg) {
    if (m.k === "input" && this.isSimulating) {
      this.remoteInputs.set(from, m.input);
      if (!this.state.players.has(from)) {
        const r = spawnRing(8)[(this.state.players.size) % 8]!;
        const name = this.pendingNames.get(from) ?? "P" + this.state.players.size;
        this.state.players.set(from, makePlayer(from, name, this.state.players.size, false, r.x, r.y));
      }
    } else if (m.k === "hello" && this.isSimulating) {
      // Remember (and apply) the client's chosen callsign.
      const name = String(m.name).slice(0, 12) || "Rookie";
      this.pendingNames.set(from, name);
      const p = this.state.players.get(from);
      if (p) p.name = name;
    } else if (m.k === "upgrade" && this.isSimulating) {
      // A client picked a level-up upgrade; apply it authoritatively to its orb.
      const p = this.state.players.get(from);
      if (p) { applyUpgradeById(p, m.id); if (p.pendingUpgrades > 0) p.pendingUpgrades--; }
    } else if (m.k === "snap" && !this.isSimulating) {
      this.applySnap(m.s);
    } else if (m.k === "restart" && !this.isSimulating) {
      // Host began a rematch: drop the game-over state so we don't immediately
      // re-trigger it, and reset our own level so stale snapshots don't pop
      // upgrade cards before the fresh state arrives.
      this.state.over = false;
      this.lostFired = false;
      this.lastSnap = performance.now(); // fresh match: don't let the stale timestamp trip the watchdog
      this.inEvents.length = 0;
      const me = this.state.players.get(this.selfId);
      if (me) { me.level = 1; me.xp = 0; }
      this.onRestart?.();
    }
  }

  chooseUpgrade(id: string) { this.channel.sendReliable({ k: "upgrade", id }); }

  /** Host: reset to a fresh match, keeping the same connected players, and tell
   *  clients to re-enter. */
  restart() {
    if (!this.isSimulating) return;
    const meta = [...this.state.players.values()].map((p) => ({ id: p.id, name: p.name, slot: p.slot }));
    const pos = spawnRing(Math.max(8, meta.length));
    const players = meta.map((m, i) => makePlayer(m.id, m.name, m.slot, false, pos[i]!.x, pos[i]!.y));
    this.state = createState((Math.random() * 1e9) | 0, players);
    this.remoteInputs.clear();
    this.snapAccum = 0;
    this.outEvents.length = 0;
    this.channel.sendReliable({ k: "restart" });
  }

  pushInput(i: Input) { this.input = i; }

  update(dt: number, events: SimEvent[]) {
    if (this.isSimulating) {
      const inputs = new Map<string, Input>(this.remoteInputs);
      inputs.set(this.selfId, this.input);
      step(this.state, dt, inputs, events);
      // queue impactful events (not slime sparkles) to forward to clients
      for (const e of events) if (e.t !== "pickup") this.outEvents.push(e);
      if (this.outEvents.length > 40) this.outEvents.splice(0, this.outEvents.length - 40);
      this.snapAccum += dt;
      if (this.snapAccum >= 1 / 20) { this.snapAccum = 0; this.send({ k: "snap", s: this.snapshot() }); }
    } else {
      this.inputAccum += dt;
      if (this.inputAccum >= 1 / 30) { this.inputAccum = 0; this.send({ k: "input", input: this.input }); }
      this.interpolate(dt);
      // surface host events to the renderer (particles + sfx)
      if (this.inEvents.length) { for (const e of this.inEvents) events.push(e); this.inEvents.length = 0; }
      // watchdog: host stopped sending mid-match → it left
      if (this.gotSnap && !this.lostFired && !this.state.over &&
          performance.now() - this.lastSnap > 5000) {
        this.lostFired = true; this.onLost?.();
      }
    }
  }

  // ── client smoothing: runs every render frame ──
  private interpolate(dt: number) {
    const follow = 1 - Math.exp(-dt * 14);  // remote orbs chase authoritative pos
    const correct = 1 - Math.exp(-dt * 2.5); // gently reconcile predicted self
    for (const p of this.state.players.values()) {
      const tgt = this.targets.get(p.id);
      if (!tgt) continue;
      if (p.id === this.selfId) {
        if (p.alive) this.predictSelf(p, dt); // instant response to our own input
        p.x += (tgt.x - p.x) * correct;
        p.y += (tgt.y - p.y) * correct;
      } else {
        p.x += (tgt.x - p.x) * follow;
        p.y += (tgt.y - p.y) * follow;
      }
    }
  }

  // Integrate our own orb locally from the live input, mirroring sim movement,
  // so it doesn't wait for the input→host→snapshot round trip. The server stays
  // authoritative for size/level/eats/death (carried in snapshots) and for the
  // gentle position correction above.
  private predictSelf(p: Player, dt: number) {
    let dx = this.input.dx, dy = this.input.dy;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const boost = p.fx.boost ? 1.55 : 1;
    const spd = CFG.player.baseSpeed * p.speedMul * speedFactor(p.size) * boost;
    p.vx += (dx * spd - p.vx) * Math.min(1, dt * 10);
    p.vy += (dy * spd - p.vy) * Math.min(1, dt * 10);
    if (p.dashCd > 0) p.dashCd -= dt;
    if (this.input.dash && p.dashCd <= 0 && m > 0.1) {
      p.vx += dx * 520; p.vy += dy * 520;
      p.dashCd = 2.6; p.fx.dashTrail = 0.25;
    }
    p.x = Math.max(20, Math.min(CFG.world.w - 20, p.x + p.vx * dt));
    p.y = Math.max(20, Math.min(CFG.world.h - 20, p.y + p.vy * dt));
  }

  private snapshot(): SnapState {
    return {
      time: this.state.time, over: this.state.over,
      players: [...this.state.players.values()].map((p) => ({
        id: p.id, name: p.name, slot: p.slot, x: Math.round(p.x), y: Math.round(p.y),
        size: Math.round(p.size * 10) / 10, level: p.level, xp: Math.round(p.xp), kills: p.kills, alive: p.alive,
        fx: Object.keys(p.fx),
      })),
      slimes: [...this.state.slimes.values()].map((s) => [s.id, Math.round(s.x), Math.round(s.y), s.kind] as [number, number, number, number]),
      powerups: [...this.state.powerups.values()].map((u) => [u.id, Math.round(u.x), Math.round(u.y), u.kind] as [number, number, number, string]),
      events: this.outEvents.splice(0), // hand off + clear
    };
  }

  private applySnap(s: SnapState) {
    this.state.time = s.time; this.state.over = s.over;
    const seen = new Set<string>();
    for (const ps of s.players) {
      seen.add(ps.id);
      let p = this.state.players.get(ps.id);
      if (!p) {
        // first sighting: place it exactly so it doesn't ease in from (0,0)
        p = makePlayer(ps.id, ps.name, ps.slot, ps.id !== this.selfId, ps.x, ps.y);
        this.state.players.set(ps.id, p);
      }
      // A large jump means a teleport (respawn) — snap rather than slide the
      // orb across the arena. Small deltas keep easing for smoothness.
      if (Math.hypot(ps.x - p.x, ps.y - p.y) > 350) {
        p.x = ps.x; p.y = ps.y;
        if (p.id === this.selfId) { p.vx = 0; p.vy = 0; }
      }
      // Record authoritative pos; update() eases positions toward it every frame.
      this.targets.set(ps.id, { x: ps.x, y: ps.y });
      p.size = ps.size; p.level = ps.level; p.xp = ps.xp; p.kills = ps.kills; p.alive = ps.alive; p.name = ps.name;
      p.fx = Object.fromEntries(ps.fx.map((k) => [k, 1]));
    }
    for (const id of [...this.state.players.keys()]) if (!seen.has(id)) { this.state.players.delete(id); this.targets.delete(id); }
    this.state.slimes.clear();
    for (const [id, x, y, kind] of s.slimes) this.state.slimes.set(id, { id, x, y, kind });
    this.state.powerups.clear();
    for (const [id, x, y, kind] of s.powerups) this.state.powerups.set(id, { id, x, y, kind: kind as never });
    if (s.events?.length) { this.inEvents.push(...s.events); if (this.inEvents.length > 80) this.inEvents.splice(0, this.inEvents.length - 80); }
    this.lastSnap = performance.now(); this.gotSnap = true;
  }

  stop() { this.channel.close(); }
}
