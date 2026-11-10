// The online link (js/net.js) between two "phones" in one sandbox: the room
// is the same-browser BroadcastChannel (?local) and the direct link a pretend
// WebRTC data channel, so the switch to the direct link and what travels on
// it can be checked without a network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Channels by name; every message goes to the other ends, a tick later.
function fakeBroadcast() {
  const rooms = {};
  return class {
    constructor(name) { this.name = name; (rooms[name] = rooms[name] || []).push(this); }
    postMessage(data) {
      const copy = JSON.parse(JSON.stringify(data));
      for (const ch of rooms[this.name]) if (ch !== this) setTimeout(() => ch.onmessage && ch.onmessage({ data: copy }), 0);
    }
    close() { rooms[this.name] = rooms[this.name].filter((c) => c !== this); }
  };
}

// Just enough of RTCPeerConnection: an offer and answer pair the two ends up
// (by a made-up SDP), and the data channel opens once both are set. `wire`
// counts every message each end sends on it.
function fakeRTC(wire) {
  const byId = {};
  let next = 0;
  return class {
    constructor() { this.id = ++next; this.connectionState = 'new'; this.signalingState = 'stable'; byId[this.id] = this; }
    createDataChannel() { this.ch = this.makeChannel(); return this.ch; }
    makeChannel() {
      const pc = this;
      return {
        readyState: 'connecting',
        send(text) { wire.push({ from: pc.id, text }); const o = pc.other.ch; setTimeout(() => o.onmessage && o.onmessage({ data: text }), 0); },
        close() { this.readyState = 'closed'; },
      };
    }
    async createOffer() { return { type: 'offer', sdp: 'pc' + this.id }; }
    async createAnswer() { return { type: 'answer', sdp: 'pc' + this.id }; }
    async setLocalDescription(d) {
      this.localDescription = d;
      if (d.type === 'offer') this.signalingState = 'have-local-offer';
      // a home-network address hidden behind a .local name, and the router's
      setTimeout(() => {
        for (const c of [`candidate:1 1 udp 2122260223 ${this.id}abc.local 50000 typ host`, 'candidate:2 1 udp 1686052607 49.36.1.2 50001 typ srflx raddr 0.0.0.0 rport 0']) {
          if (this.onicecandidate) this.onicecandidate({ candidate: { candidate: c, toJSON() { return { candidate: c, sdpMid: '0' }; } } });
        }
      }, 0);
    }
    async setRemoteDescription(d) {
      this.other = byId[+d.sdp.slice(2)];
      if (d.type === 'offer') {
        // the guest's end of the channel arrives with the offer
        this.ch = this.makeChannel();
        this.other.other = this;
        setTimeout(() => { this.ondatachannel && this.ondatachannel({ channel: this.ch }); }, 0);
      } else {
        this.signalingState = 'stable';
        // both ends set: open
        setTimeout(() => { for (const c of [this.ch, this.other.ch]) { c.readyState = 'open'; c.onopen && c.onopen(); } }, 0);
      }
    }
    async addIceCandidate() {}
    close() { this.connectionState = 'closed'; }
  };
}

function loadNet(wire) {
  const store = {};
  const sandbox = {
    location: { search: '?local', hostname: 'localhost', host: 'localhost' },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    performance, setTimeout, clearTimeout, setInterval, clearInterval, Math, JSON, Promise,
    BroadcastChannel: fakeBroadcast(), RTCPeerConnection: fakeRTC(wire),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'net.js'), 'utf8'), sandbox, { filename: 'net.js' });
  return sandbox.CT.Net;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('direct link: a quiet phone keeps its wifi awake, and the notes never reach the game', async (t) => {
  const wire = [];
  const Net = loadNet(wire);
  const got = { host: [], guest: [] };
  const host = Net.connect('ABCD', 'host', (m) => got.host.push(m));
  const guest = Net.connect('ABCD', 'guest', (m) => got.guest.push(m));
  t.after(() => { host.close(); guest.close(); });
  for (let i = 0; i < 50 && !(host.direct() && guest.direct()); i++) await wait(10);
  assert.ok(host.direct() && guest.direct(), 'the direct link opened');
  await wait(20);
  const d = guest.diag();
  assert.deepEqual([d.state, d.offers, d.mine, d.theirs], ['trying', 1, 'mdns srflx', 'mdns srflx'], 'notes on the link for ?ping');
  guest.send({ t: 'in', k: 'toss' });

  // the host sends a snapshot every 50 ms; the guest sends nothing more
  wire.length = 0;
  const t0 = performance.now();
  const snaps = setInterval(() => host.send({ t: 'st', s: 1 }), 50);
  await wait(600);
  clearInterval(snaps);
  const secs = (performance.now() - t0) / 1000;
  const hostPc = wire.find((w) => w.text.includes('"st"')).from;
  const fromGuest = wire.filter((w) => w.from !== hostPc);
  assert.ok(fromGuest.length >= 8, `the guest sent ${fromGuest.length} keep-awake notes in ${secs.toFixed(2)} s`);
  assert.ok(fromGuest.length / secs <= 22, 'about 20 a second, no more');
  assert.ok(fromGuest.every((w) => w.text === '{"t":"ka"}'), 'each a tiny note');

  await wait(20);
  assert.deepEqual(got.host.map((m) => m.t), ['in'], 'the host only got the real message');
  assert.ok(got.guest.length >= 8 && got.guest.every((m) => m.t === 'st'), 'the guest only got snapshots');

  host.close();
  guest.close();
  wire.length = 0;
  await wait(150);
  assert.equal(wire.length, 0, 'nothing more once the link is closed');
});
