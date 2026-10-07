// Relay for online matches: a Cloudflare Worker with one Durable Object per
// room code. It holds at most one host and one guest socket and passes every
// message from one to the other unchanged. The game itself runs on the
// host's phone; this only forwards.
//
// Clients connect to wss://<worker>/room/<CODE>?role=host|guest

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return new Response('cyberpunk tennis relay', { status: 200 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const role = url.searchParams.get('role');
    if (role !== 'host' && role !== 'guest') return new Response('Bad role', { status: 400 });
    const room = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return room.fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role');
    // a reconnect replaces the old socket for the same role
    for (const old of this.state.getWebSockets(role)) old.close(4000, 'replaced');
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [role]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 16384) return;
    const role = this.state.getTags(ws)[0];
    const other = role === 'host' ? 'guest' : 'host';
    for (const peer of this.state.getWebSockets(other)) {
      try { peer.send(message); } catch (e) { /* peer gone */ }
    }
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'closed'); } catch (e) { /* already closed */ }
  }
}
