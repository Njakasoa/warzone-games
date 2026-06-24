const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://api.njakasoa.xyz";

/**
 * Connect to the core-api realtime gateway as an anonymous guest.
 * Requires the `POST /v1/auth/guest` endpoint (see the companion core-api PR):
 * it returns a short-lived access token so the browser can open /rt without a
 * full account. Returns the open socket + the guest's own id (from /rt ready).
 */
export async function connectOnline(room: string): Promise<{ ws: WebSocket; selfId: string }> {
  const res = await fetch(`${API_BASE}/v1/auth/guest`, { method: "POST" });
  if (!res.ok) throw new Error(`guest auth failed: ${res.status}`);
  const { accessToken } = (await res.json()) as { accessToken: string };

  const wsUrl = `${API_BASE.replace(/^http/, "ws")}/rt?token=${encodeURIComponent(accessToken)}`;
  const ws = new WebSocket(wsUrl);

  const selfId = await new Promise<string>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("ws timeout")), 8000);
    ws.addEventListener("error", () => { clearTimeout(to); reject(new Error("ws error")); });
    ws.addEventListener("message", (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m.type === "ready") { clearTimeout(to); resolve(String(m.userId)); }
      } catch {}
    }, { once: false });
  });

  ws.send(JSON.stringify({ type: "join", room }));
  return { ws, selfId };
}
