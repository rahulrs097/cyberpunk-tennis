// Relay for online matches: a Cloudflare Worker with one Durable Object per
// room code. It holds at most one host and one guest socket and passes every
// message from one to the other unchanged. The game itself runs on the
// host's phone; this only forwards.
//
// GET /version answers { v: <this deployment's id> }.
//
// Clients connect to wss://<worker>/room/<CODE>?role=host|guest&id=<phone>,
// where id is a random id each phone keeps. Every other path is the game
// itself, served from the static files.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // which build is live, so an open (installed) game knows to reload
    if (url.pathname === '/version') {
      const v = env.CF_VERSION_METADATA ? env.CF_VERSION_METADATA.id : '';
      return new Response(JSON.stringify({ v }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('cyberpunk tennis relay');
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
    const params = new URL(request.url).searchParams;
    const role = params.get('role');
    const id = 'id:' + (/^[A-Za-z0-9]{1,32}$/.test(params.get('id') || '') ? params.get('id') : '');
    const pair = new WebSocketPair();
    // One phone a side. The same phone coming back (a dropped connection)
    // takes its old place; anyone else is turned away (4001) while that side
    // is still connected, so a third person with the code can't knock the
    // guest out of a match.
    const old = this.state.getWebSockets(role);
    if (old.some((ws) => this.state.getTags(ws)[1] !== id)) {
      pair[1].accept();
      pair[1].close(4001, 'room full');
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    for (const ws of old) ws.close(4000, 'replaced');
    this.state.acceptWebSocket(pair[1], [role, id]);
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
