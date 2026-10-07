// Messages between the two phones in an online match.
// With CT.RELAY_URL set, they go over a WebSocket to the Cloudflare Worker
// relay (server/relay.js). Without it, two tabs in the same browser talk over
// a BroadcastChannel, which is how the prototype is tested on one machine.
(function () {
  const CT = (window.CT = window.CT || {});

  // The Cloudflare Worker relay. Add ?local to the page URL to use the
  // same-browser tab link instead (for testing on one machine).
  const local = /[?&]local\b/.test(location.search);
  CT.RELAY_URL = CT.RELAY_URL || (local ? '' : 'wss://cyberpunk-tennis.rahulrs097.workers.dev');

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
    if (CT.RELAY_URL) {
      const ws = new WebSocket(`${CT.RELAY_URL}/room/${code}?role=${role}`);
      ws.onmessage = (e) => { const m = parse(e.data); if (m) onMessage(m); };
      ws.onopen = () => status('open');
      ws.onclose = () => status('closed');
      ws.onerror = () => status('error');
      return {
        send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
        close: () => { try { ws.close(); } catch (e) { /* already closed */ } },
      };
    }
    const ch = new BroadcastChannel('ct-room-' + code);
    ch.onmessage = (e) => {
      const env = parse(e.data);
      if (env && env.from !== role) onMessage(env.m);
    };
    setTimeout(() => status('open'), 0);
    return {
      send: (m) => ch.postMessage(JSON.stringify({ from: role, m })),
      close: () => ch.close(),
    };
  }

  CT.Net = { connect, makeCode };
})();
