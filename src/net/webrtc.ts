import type { NetChannel } from "./transport.ts";

/**
 * Host-authoritative star over WebRTC. The host is the WebRTC peer everyone
 * connects to; each client opens one unreliable DataChannel to the host. Game
 * traffic (inputs / snapshots) then flows *peer to peer*, cutting the relay
 * server out of the hot path — which is the whole point: latency becomes
 * client↔host instead of client↔server↔host.
 *
 * The existing realtime WebSocket is reused only for:
 *   • signaling (SDP offer/answer + ICE candidates),
 *   • presence (lobby player count),
 *   • a transparent fallback: until a peer's DataChannel is open — or if NAT
 *     traversal fails with no TURN server — that peer's game traffic is relayed
 *     over the WS, so the link degrades to the old behaviour instead of breaking.
 *
 * Provide a TURN server via VITE_TURN_URL/USER/PASS for players behind strict
 * (symmetric) NATs; STUN alone covers most home connections.
 */

// Fallback if no ICE servers are supplied (e.g. signaling-only dev). In normal
// operation the servers come from core-api's /v1/turn/credentials (Cloudflare
// TURN), passed into the constructor.
const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

interface Peer {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  remoteSet: boolean;
  pendingIce: RTCIceCandidateInit[];
}

// Signaling/relay envelopes carried inside the WS `broadcast` data field.
type Sig =
  | { sig: "host-here" }
  | { sig: "join-rtc" }
  | { sig: "offer"; to: string; desc: RTCSessionDescriptionInit }
  | { sig: "answer"; to: string; desc: RTCSessionDescriptionInit }
  | { sig: "ice"; to: string; candidate: RTCIceCandidateInit }
  | { game: unknown; to?: string };

export class RtcChannel implements NetChannel {
  readonly selfId: string;
  private ws: WebSocket;
  private room: string;
  private host: boolean;
  private hostId?: string;
  private peers = new Map<string, Peer>(); // keyed by the *other* peer's id
  private gameCb?: (from: string, data: unknown) => void;
  private peersCb?: (n: number) => void;
  private rtc: RTCConfiguration;

  constructor(opts: { ws: WebSocket; selfId: string; room: string; host: boolean; iceServers?: RTCIceServer[] }) {
    this.ws = opts.ws;
    this.selfId = opts.selfId;
    this.room = opts.room;
    this.host = opts.host;
    this.rtc = { iceServers: opts.iceServers?.length ? opts.iceServers : DEFAULT_ICE };
    this.ws.addEventListener("message", (e) => this.onWs(String(e.data)));
    // Announce ourselves so the other side starts the handshake. Both messages
    // are sent so either join order (host first / client first) converges.
    this.signal(this.host ? { sig: "host-here" } : { sig: "join-rtc" });
  }

  onMessage(cb: (from: string, data: unknown) => void) { this.gameCb = cb; }
  onPeers(cb: (n: number) => void) { this.peersCb = cb; }

  /** Send a game message to our counterpart(s): host → every client, client → host. */
  send(data: unknown) {
    if (this.host) {
      for (const [id, p] of this.peers) {
        if (p.dc?.readyState === "open") p.dc.send(JSON.stringify(data));
        else this.wsSend({ game: data, to: id }); // targeted fallback for this client only
      }
    } else {
      const p = this.hostId ? this.peers.get(this.hostId) : undefined;
      if (p?.dc?.readyState === "open") p.dc.send(JSON.stringify(data));
      else this.wsSend({ game: data }); // only the host consumes client inputs
    }
  }

  /** Guaranteed delivery for rare events (e.g. upgrade picks): always via the
   *  TCP-reliable signaling WebSocket, never the lossy DataChannel. */
  sendReliable(data: unknown) {
    if (this.host) for (const id of this.peers.keys()) this.wsSend({ game: data, to: id });
    else this.wsSend({ game: data }); // only the host consumes it
  }

  close() {
    for (const p of this.peers.values()) { try { p.dc?.close(); } catch { /* */ } try { p.pc.close(); } catch { /* */ } }
    this.peers.clear();
    try { this.ws.close(); } catch { /* */ }
  }

  // ── WS plumbing ──
  private wsSend(data: Sig) { this.ws.send(JSON.stringify({ type: "broadcast", room: this.room, data })); }
  private signal(s: Sig) { this.wsSend(s); }

  private onWs(raw: string) {
    let env: { type?: string; from?: string; data?: Sig; count?: number };
    try { env = JSON.parse(raw); } catch { return; }
    if (env.type === "presence") this.peersCb?.(env.count ?? 1);
    if (env.type !== "message" || !env.data || !env.from) return;
    const d = env.data;
    if ("sig" in d) { this.onSignal(env.from, d); return; }
    if ("game" in d) {
      if (d.to && d.to !== this.selfId) return; // not for us
      this.gameCb?.(env.from, d.game);
    }
  }

  // ── signaling state machine ──
  private onSignal(from: string, d: Extract<Sig, { sig: string }>) {
    switch (d.sig) {
      case "host-here":
        if (!this.host && !this.peers.has(from)) this.signal({ sig: "join-rtc" });
        break;
      case "join-rtc":
        if (this.host && !this.peers.has(from)) void this.hostOffer(from);
        break;
      case "offer":
        if (!this.host && d.to === this.selfId && !this.peers.has(from)) void this.clientAnswer(from, d.desc);
        break;
      case "answer": {
        if (this.host && d.to === this.selfId) { const p = this.peers.get(from); if (p) void this.setRemote(p, d.desc); }
        break;
      }
      case "ice": {
        if (d.to !== this.selfId) break;
        const p = this.peers.get(from);
        if (p) this.addIce(p, d.candidate);
        break;
      }
    }
  }

  private newPeer(peerId: string): Peer {
    const pc = new RTCPeerConnection(this.rtc);
    const peer: Peer = { pc, remoteSet: false, pendingIce: [] };
    pc.onicecandidate = (e) => { if (e.candidate) this.signal({ sig: "ice", to: peerId, candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        try { peer.dc?.close(); } catch { /* */ }
        this.peers.delete(peerId);
      }
    };
    this.peers.set(peerId, peer);
    return peer;
  }

  private async hostOffer(clientId: string) {
    const peer = this.newPeer(clientId);
    // Unreliable + unordered: realtime snapshots, no head-of-line blocking.
    const dc = peer.pc.createDataChannel("game", { ordered: false, maxRetransmits: 0 });
    this.wireDc(peer, dc, clientId);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.signal({ sig: "offer", to: clientId, desc: { type: offer.type, sdp: offer.sdp } });
  }

  private async clientAnswer(hostId: string, desc: RTCSessionDescriptionInit) {
    this.hostId = hostId;
    const peer = this.newPeer(hostId);
    peer.pc.ondatachannel = (e) => this.wireDc(peer, e.channel, hostId);
    await this.setRemote(peer, desc);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    this.signal({ sig: "answer", to: hostId, desc: { type: answer.type, sdp: answer.sdp } });
  }

  private wireDc(peer: Peer, dc: RTCDataChannel, peerId: string) {
    peer.dc = dc;
    dc.onmessage = (e) => { try { this.gameCb?.(peerId, JSON.parse(String(e.data))); } catch { /* */ } };
  }

  private async setRemote(peer: Peer, desc: RTCSessionDescriptionInit) {
    await peer.pc.setRemoteDescription(desc);
    peer.remoteSet = true;
    for (const c of peer.pendingIce) { try { await peer.pc.addIceCandidate(c); } catch { /* */ } }
    peer.pendingIce = [];
  }

  private addIce(peer: Peer, candidate: RTCIceCandidateInit) {
    if (peer.remoteSet) peer.pc.addIceCandidate(candidate).catch(() => {});
    else peer.pendingIce.push(candidate); // queue until the remote description is set
  }
}
