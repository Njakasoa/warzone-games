import { Application } from "pixi.js";
import { World } from "./render/world.ts";
import { Controls } from "./input.ts";
import { UI } from "./ui.ts";
import { sfx, resumeAudio } from "./audio.ts";
import { offer } from "./core/upgrades.ts";
import type { SimEvent } from "./core/sim.ts";
import { LocalTransport, RealtimeTransport, type NetGame } from "./net/transport.ts";
import { connectOnline } from "./net/online.ts";
import { RtcChannel } from "./net/webrtc.ts";

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
      const { ws, selfId, iceServers } = await connectOnline(room);
      // WS handles signaling + presence; game traffic goes peer-to-peer (WebRTC),
      // falling back to the WS relay until/unless a peer connection is established.
      const channel = new RtcChannel({ ws, selfId, room, host: isHost, iceServers });
      const rt = new RealtimeTransport({ channel, selfId, name, host: isHost, seed: (Math.random() * 1e9) | 0 });
      this.net = rt;
      rt.onPlayers = (n) => lobby.setCount(n);
      // Defer: onLost fires from inside net.update(); tearing down this.net
      // mid-frame would null it out before the rest of frame() runs.
      rt.onLost = () => { this.ui.toast("Host left — match ended"); setTimeout(() => this.menu(), 0); };
      lobby.setStatus(isHost ? "Waiting for players… 1 online" : "Connected — entering match");
      if (!isHost && !started) this.enterMatch(); // clients jump in; render from snapshots
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      lobby.setError(`Couldn't reach the server (${msg}). The API must be up and allow this site's origin (CORS).`);
    }
  }

  private upgradesChosen = 0; // client: level-up picks already made this match
  private overFlush = 0;      // host: time spent broadcasting the final (over) state

  private enterMatch() {
    this.ui.enterHud(() => this.menu());
    this.running = true;
    this.upgradesChosen = 0;
    this.overFlush = 0;
  }

  private frame(dtRaw: number) {
    const dt = Math.min(0.05, dtRaw); // clamp to avoid tunneling on tab-out
    if (!this.net) return;
    const state = this.net.state;
    const sim = this.net.isSimulating;

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
    } else if (sim && state.over && this.overFlush < 3) {
      // Match ended: keep broadcasting the final snapshot for a few seconds so
      // clients reliably receive over=true (the DataChannel is unreliable).
      this.overFlush += dt;
      this.net.update(dt, []);
    }

    this.world.draw(state, this.net.selfId, dt);
    if (this.running) this.ui.updateHud(state, this.net.selfId);

    // level-up cards. Host/solo apply locally; clients owe one pick per level
    // gained and the host applies the chosen upgrade authoritatively.
    const me = state.players.get(this.net.selfId);
    if (this.running && me && !this.ui.upgradeOpen) {
      if (sim) {
        if (me.pendingUpgrades > 0) {
          const cards = offer(Math.random);
          this.ui.showUpgrades(cards, (u) => { u.apply(me); me.pendingUpgrades--; });
        }
      } else if (me.level - 1 > this.upgradesChosen) {
        const cards = offer(Math.random);
        this.ui.showUpgrades(cards, (u) => { this.upgradesChosen++; this.net!.chooseUpgrade(u.id); });
      }
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
