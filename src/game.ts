import { Application } from "pixi.js";
import { World } from "./render/world.ts";
import { Controls } from "./input.ts";
import { UI } from "./ui.ts";
import { sfx, resumeAudio } from "./audio.ts";
import { offer } from "./core/upgrades.ts";
import type { SimEvent } from "./core/sim.ts";
import { LocalTransport, RealtimeTransport, type NetGame } from "./net/transport.ts";
import { connectOnline } from "./net/online.ts";

export class Game {
  private app = new Application();
  private world!: World;
  private controls!: Controls;
  private ui!: UI;
  private net?: NetGame;
  private running = false;

  async start() {
    await this.app.init({
      background: "#0a0a12", resizeTo: window, antialias: true,
      resolution: Math.min(window.devicePixelRatio ?? 1, 2), autoDensity: true,
    });
    document.getElementById("app")!.appendChild(this.app.canvas);
    this.world = new World(this.app);
    this.controls = new Controls(this.app.canvas);
    this.ui = new UI(document.getElementById("ui")!);
    this.app.ticker.add((t) => this.frame(t.deltaMS / 1000));
    this.menu();
  }

  private menu() {
    this.stopNet();
    this.ui.showMenu({
      onSolo: (name, bots) => { resumeAudio(); this.beginSolo(name, bots); },
      onOnline: (name) => { resumeAudio(); this.beginOnline(name); },
    });
  }

  private beginSolo(name: string, bots: number) {
    this.net = new LocalTransport(name, bots);
    this.enterMatch();
  }

  private async beginOnline(name: string) {
    const code = (prompt("Room code to join — leave blank to create one:") || "").trim().toUpperCase();
    const isHost = code.length === 0;
    const room = isHost ? randomCode() : code;

    // Show the lobby (and the code) right away — it only needs the code, which
    // we already have. The network connect happens after, so a failure surfaces
    // here instead of silently bouncing back to a solo game.
    let started = false;
    const lobby = this.ui.showLobby({
      code: room, isHost,
      onStart: () => { started = true; this.enterMatch(); },
      onLeave: () => this.menu(),
    });

    try {
      const { ws, selfId } = await connectOnline(room);
      const rt = new RealtimeTransport({ ws, room, selfId, name, host: isHost, seed: (Math.random() * 1e9) | 0 });
      this.net = rt;
      rt.onPlayers = (n) => lobby.setCount(n);
      lobby.setStatus(isHost ? "Waiting for players… 1 online" : "Connected — entering match");
      if (!isHost && !started) this.enterMatch(); // clients jump in; render from snapshots
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      lobby.setError(`Couldn't reach the server (${msg}). The API must be up and allow this site's origin (CORS).`);
    }
  }

  private enterMatch() {
    this.ui.enterHud(() => this.menu());
    this.running = true;
  }

  private frame(dtRaw: number) {
    const dt = Math.min(0.05, dtRaw); // clamp to avoid tunneling on tab-out
    if (!this.net) return;
    const state = this.net.state;

    if (this.running && !this.ui.upgradeOpen) {
      this.net.pushInput(this.controls.sample());
      const events: SimEvent[] = [];
      this.net.update(dt, events);
      for (const e of events) {
        this.world.emit(e);
        if (e.t === "pickup") sfx.pickup();
        else if (e.t === "eat") sfx.eat();
        else if (e.t === "death") sfx.death();
        else if (e.t === "power") sfx.power();
        else if (e.t === "level" && e.id === this.net.selfId) sfx.level();
      }
    }

    this.world.draw(state, this.net.selfId, dt);
    if (this.running) this.ui.updateHud(state, this.net.selfId);

    // level-up cards (local human only, solo pauses while choosing)
    const me = state.players.get(this.net.selfId);
    if (this.running && me && me.pendingUpgrades > 0 && !this.ui.upgradeOpen) {
      const cards = offer(Math.random);
      this.ui.showUpgrades(cards, (u) => { u.apply(me); me.pendingUpgrades--; });
    }

    if (this.running && state.over) {
      this.running = false;
      sfx.death();
      this.ui.showGameOver(state, this.net.selfId, () => this.menu());
    }
  }

  private stopNet() { this.net?.stop(); this.net = undefined; this.running = false; }
}

function randomCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => a[(Math.random() * a.length) | 0]).join("");
}
