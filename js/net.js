// Messages between the two phones in an online match.
// With CT.RELAY_URL set, they go over a WebSocket to the Cloudflare Worker
// relay (server/relay.js). Without it, two tabs in the same browser talk over
// a BroadcastChannel, which is how the prototype is tested on one machine.
(function () {
  const CT = (window.CT = window.CT || {});

  // The Cloudflare Worker relay. Add ?local to the page URL to use the
  // same-browser tab link instead (for testing on one machine).
  const local = /[?&]local\b/.test(location.search);
  // When the game is served by that same Worker, use its own address.
  const sameHost = /\.workers\.dev$/.test(location.hostname) ? 'wss://' + location.host : '';
  CT.RELAY_URL = CT.RELAY_URL || (local ? '' : sameHost || 'wss://cyberpunk-tennis.rahulrs097.workers.dev');

  // Letters that can't be misread for each other (no I/O/0/1).
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  function makeCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  // role: 'host' | 'guest'. onMessage gets parsed objects; onStatus gets
  // 'open' | 'closed' | 'error'. Messages travel as JSON either way, so the
  // tab prototype exercises the same encoding as the real relay.
  function connect(code, role, onMessage, onStatus) {
    const status = onStatus || (() => {});
    const parse = (text) => { try { return JSON.parse(text); } catch (e) { return null; } };
    // CT.Net.lag (?lag= in the page URL) holds each message back that many
    // ms, in order, to try the game on a slow link
    let due = 0;
    const later = (post) => (text) => {
      if (!CT.Net.lag) { post(text); return; }
      const now = performance.now();
      due = Math.max(due, now + CT.Net.lag);
      setTimeout(() => post(text), due - now);
    };
    if (CT.RELAY_URL) {
      const ws = new WebSocket(`${CT.RELAY_URL}/room/${code}?role=${role}`);
      ws.onmessage = (e) => { const m = parse(e.data); if (m) onMessage(m); };
      ws.onopen = () => status('open');
      ws.onclose = () => status('closed');
      ws.onerror = () => status('error');
      const post = later((text) => { if (ws.readyState === 1) ws.send(text); });
      return {
        send: (m) => post(JSON.stringify(m)),
        close: () => { try { ws.close(); } catch (e) { /* already closed */ } },
      };
    }
    const ch = new BroadcastChannel('ct-room-' + code);
    ch.onmessage = (e) => {
      const env = parse(e.data);
      if (env && env.from !== role) onMessage(env.m);
    };
    setTimeout(() => status('open'), 0);
    const post = later((text) => ch.postMessage(text));
    return {
      send: (m) => post(JSON.stringify({ from: role, m })),
      close: () => ch.close(),
    };
  }

  // Lag in an online match. Each phone pings the other every PING_EVERY ms
  // and the other answers at once. The ping is the round trip, smoothed, and
  // never less than how long the oldest unanswered ping has been out, so a
  // stalled link shows at once. Over `show` ms it goes up on the billboard
  // (yellow, red over `red`); over `pause` the match stops until the ping has
  // been back at `pause` or under for `calm` ms.
  const PING_EVERY = 500;
  const LAG = { show: 150, red: 400, pause: 450, calm: 1000 };
  function createLagMeter() {
    const out = [];   // send times of the pings not answered yet
    let rtt = null, held = false, calmSince = null;
    return {
      sent(now) { out.push(now); },
      answered(at, now) {
        while (out.length && out[0] <= at) out.shift();
        rtt = rtt === null ? now - at : rtt + (now - at - rtt) * 0.4;
      },
      // { ms, level: null | 'yellow' | 'red', held }
      state(now) {
        const ms = Math.max(rtt || 0, out.length ? now - out[0] : 0);
        if (!held) { if (ms > LAG.pause) { held = true; calmSince = null; } }
        else if (ms > LAG.pause) calmSince = null;
        else if (calmSince === null) calmSince = now;
        else if (now - calmSince >= LAG.calm) held = false;
        return { ms, level: ms > LAG.red ? 'red' : ms > LAG.show ? 'yellow' : null, held };
      },
    };
  }

  const lagParam = /[?&]lag=(\d+)/.exec(location.search);
  CT.Net = { connect, makeCode, createLagMeter, PING_EVERY, LAG, lag: lagParam ? +lagParam[1] : 0 };
})();
