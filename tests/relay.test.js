// The online relay (server/relay.js) against a stand-in for Cloudflare's
// Durable Object state and WebSockets. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeSocket {
  accept() { this.accepted = true; }
  close(code) { this.closedWith = code; }
  send(m) { (this.sent = this.sent || []).push(m); }
}

// relay.js is a Worker module; run it as a script with its exports collected
function loadRelay() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay.js'), 'utf8')
    .replace('export default', 'exports.default =')
    .replace('export class Room', 'exports.Room = class Room');
  const sandbox = {
    exports: {}, URL,
    WebSocketPair: function () { const a = new FakeSocket(), b = new FakeSocket(); a.peer = b; return { 0: a, 1: b }; },
    Response: class { constructor(body, init) { Object.assign(this, init); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'relay.js' });
  return sandbox.exports;
}

// A room, and a way to connect a phone to it: returns the room's end of
// the socket, or the refusal code.
function makeRoom() {
  const { Room } = loadRelay();
  const socks = [];
  const room = new Room({
    acceptWebSocket(ws, tags) { ws.tags = tags; socks.push(ws); },
    getWebSockets(tag) { return socks.filter((w) => w.closedWith === undefined && w.tags.includes(tag)); },
    getTags(ws) { return ws.tags; },
  });
  const join = async (role, id) => {
    const res = await room.fetch({ url: `https://relay/room/ABCD?role=${role}&id=${id}` });
    assert.equal(res.status, 101);
    const end = res.webSocket.peer;
    return end.closedWith === 4001 ? 'full' : end;
  };
  return { room, join };
}

test('relay: a third phone with the room code is turned away, and the guest stays', async () => {
  const { room, join } = makeRoom();
  const host = await join('host', 'hostphone');
  const guest = await join('guest', 'guestphone');
  assert.equal(await join('guest', 'otherphone'), 'full');
  assert.equal(await join('host', 'otherphone'), 'full');
  room.webSocketMessage(host, 'hi');
  assert.deepEqual(guest.sent, ['hi'], 'the match carries on between the two');
  assert.equal(guest.closedWith, undefined);
});

test('relay: the same phone can take its place again after a dropped connection', async () => {
  const { room, join } = makeRoom();
  const host = await join('host', 'hostphone');
  const first = await join('guest', 'guestphone');
  const again = await join('guest', 'guestphone');
  assert.equal(first.closedWith, 4000, 'the old socket is replaced');
  room.webSocketMessage(host, 'hi');
  assert.deepEqual(again.sent, ['hi']);
  // once the guest has gone, someone else can join
  again.close(1000);
  assert.notEqual(await join('guest', 'otherphone'), 'full');
});
