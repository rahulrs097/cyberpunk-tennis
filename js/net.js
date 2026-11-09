// Messages between the two phones in an online match.
// With CT.RELAY_URL set, they go over a WebSocket to the Cloudflare Worker
// relay (server/relay.js). Without it, two tabs in the same browser talk over
// a BroadcastChannel, which is how the prototype is tested on one machine.
// Either way the phones then try to switch to a direct link (see connect).
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

  // This phone's id for the relay, kept on the phone: after a dropped
  // connection only this phone can take its place in the room again.
  let phoneId = '';
  try { phoneId = localStorage.getItem('ct.phoneId') || ''; } catch (e) { /* storage is optional */ }
  if (!/^[a-z0-9]{16}$/.test(phoneId)) {
    phoneId = '';
    for (let i = 0; i < 16; i++) phoneId += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    try { localStorage.setItem('ct.phoneId', phoneId); } catch (e) { /* storage is optional */ }
  }

  // The way the two phones reach each other at first: the relay WebSocket,
  // or the same-browser BroadcastChannel. Carries text both ways.
  function openRoom(code, role, onText, status) {
    if (CT.RELAY_URL) {
      const ws = new WebSocket(`${CT.RELAY_URL}/room/${code}?role=${role}&id=${phoneId}`);
      ws.onmessage = (e) => onText(e.data);
      ws.onopen = () => status('open');
      ws.onclose = (e) => status(e.code === 4001 ? 'full' : 'closed');
      ws.onerror = () => status('error');
      return {
        send: (text) => { if (ws.readyState === 1) ws.send(text); },
        close: () => { try { ws.close(); } catch (e) { /* already closed */ } },
      };
    }
    const ch = new BroadcastChannel('ct-room-' + code);
    ch.onmessage = (e) => { if (e.data && e.data.from !== role) onText(e.data.text); };
    setTimeout(() => status('open'), 0);
    return {
      send: (text) => ch.postMessage({ from: role, text }),
      close: () => ch.close(),
    };
  }

  // Once both phones are in the room they try for a direct link (a WebRTC
  // data channel), swapping the setup messages through the room. When it
  // opens, messages go that way instead. If it never opens (some mobile
  // networks won't allow one) or it drops, they go through the room as
  // before. Add ?relay to the page URL to never try.
  const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  const DIRECT_WAIT = 8000;   // ms to wait for the direct link to open
  const tryDirect = typeof RTCPeerConnection === 'function' && !/[?&]relay\b/.test(location.search);

  // role: 'host' | 'guest'. onMessage gets parsed objects; onStatus gets
  // 'open' | 'closed' | 'error', or 'full' when the room already has
  // another phone on that side. Messages travel as JSON either way, so the
  // tab prototype exercises the same encoding as the real relay.
  function connect(code, role, onMessage, onStatus) {
    const status = onStatus || (() => {});
    const parse = (text) => { try { return JSON.parse(text); } catch (e) { return null; } };
    const deliver = (m) => { if (m && m.t !== 'rtc') onMessage(m); };
    let pc = null, dc = null, direct = false, closed = false;
    let offerId = 0, waitTimer = 0, askTimer = 0;
    // The other phone's first messages over the direct link wait here until
    // its last one through the room ('via') has arrived, so nothing is
    // taken out of order at the switch.
    let held = null, viaSeen = false;
    let signals = Promise.resolve();   // setup messages, handled one at a time

    const room = openRoom(code, role, (text) => {
      const m = parse(text);
      if (m && m.t === 'rtc' && m.k === 'via') { if (m.id === offerId) { viaSeen = true; release(); } }
      else if (m && m.t === 'rtc') signals = signals.then(() => onSignal(m)).catch(() => { /* no direct link this time */ });
      else deliver(m);
    }, (st) => {
      status(st);
      if (st === 'open' && tryDirect && role === 'guest') askForOffer();
    });
    const signal = (m) => room.send(JSON.stringify({ t: 'rtc', ...m }));

    // The guest asks and the host offers. The guest asks again every two
    // seconds until an offer comes, in case the host wasn't there yet.
    function askForOffer() {
      let n = 0;
      clearInterval(askTimer);
      signal({ k: 'ready' });
      askTimer = setInterval(() => { if (pc || ++n > 5) clearInterval(askTimer); else signal({ k: 'ready' }); }, 2000);
    }

    function newPeer(id) {
      dropPeer();
      offerId = id;
      viaSeen = false;
      const p = (pc = new RTCPeerConnection({ iceServers: STUN }));
      p.onicecandidate = (e) => { if (e.candidate && pc === p) signal({ k: 'ice', id, c: e.candidate.toJSON() }); };
      p.onconnectionstatechange = () => { if (pc === p && p.connectionState === 'failed') dropPeer(); };
      waitTimer = setTimeout(() => { if (pc === p && !direct) dropPeer(); }, DIRECT_WAIT);
      return p;
    }

    function useChannel(ch) {
      dc = ch;
      held = viaSeen ? null : [];
      ch.onopen = () => {
        if (dc !== ch || closed) return;
        signal({ k: 'via', id: offerId });   // the last message through the room
        direct = true;
        clearTimeout(waitTimer);
        // in case the other phone's 'via' is lost
        setTimeout(() => { if (dc === ch) release(); }, 2000);
      };
      ch.onmessage = (e) => {
        if (dc !== ch) return;
        const m = parse(e.data);
        if (held) held.push(m); else deliver(m);
      };
      ch.onclose = () => { if (dc === ch) dropPeer(); };
    }

    function release() {
      const h = held;
      held = null;
      if (h) h.forEach(deliver);
    }

    // back through the room
    function dropPeer() {
      clearTimeout(waitTimer);
      const p = pc, ch = dc;
      pc = dc = null;
      direct = false;
      release();
      if (ch) try { ch.close(); } catch (e) { /* gone */ }
      if (p) try { p.close(); } catch (e) { /* gone */ }
    }

    async function onSignal(m) {
      if (closed || !tryDirect) return;
      if (m.k === 'ready' && role === 'host') {
        // asked again (the guest came back): start over
        const p = newPeer(offerId + 1), id = offerId;
        useChannel(p.createDataChannel('game'));
        await p.setLocalDescription(await p.createOffer());
        if (pc === p) signal({ k: 'offer', id, sdp: p.localDescription.sdp });
      } else if (m.k === 'offer' && role === 'guest') {
        clearInterval(askTimer);
        const p = newPeer(m.id);
        p.ondatachannel = (e) => { if (pc === p) useChannel(e.channel); };
        await p.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        await p.setLocalDescription(await p.createAnswer());
        if (pc === p) signal({ k: 'answer', id: m.id, sdp: p.localDescription.sdp });
      } else if (!pc || m.id !== offerId) {
        // about a link that's been given up on
      } else if (m.k === 'answer' && role === 'host' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      } else if (m.k === 'ice' && m.c) {
        await pc.addIceCandidate(m.c);
      }
    }

    // CT.Net.lag (?lag= in the page URL) holds each message back that many
    // ms, in order, to try the game on a slow link
    let due = 0;
    const isDirect = () => direct && dc.readyState === 'open';
    const post = (text) => { if (isDirect()) dc.send(text); else room.send(text); };
    const later = (text) => {
      if (!CT.Net.lag) { post(text); return; }
      const now = performance.now();
      due = Math.max(due, now + CT.Net.lag);
      setTimeout(() => post(text), due - now);
    };
    return {
      send: (m) => later(JSON.stringify(m)),
      // true while messages go straight to the other phone
      direct: isDirect,
      close: () => { closed = true; clearInterval(askTimer); dropPeer(); room.close(); },
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

  // Quick match: wait in the relay's queue until another phone is there,
  // then onMatch({ code, role }) once, with the room to meet in and which
  // side this phone takes. Without the relay (?local), tabs in the same
  // browser find each other over a BroadcastChannel instead: each one says
  // it's looking, and of two looking the one with the lower id makes the
  // room and hosts. onStatus gets 'open', or 'error' when the server can't be
  // reached (the queue keeps trying again every few seconds until closed).
  function seekMatch(onMatch, onStatus) {
    const status = onStatus || (() => {});
    let done = false, ws = null, retry = 0;
    const found = (m) => {
      if (done) return;
      done = true;
      close();
      onMatch(m);
    };
    function close() {
      done = true;
      clearTimeout(retry);
      if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* gone */ } }
      if (ch) { clearInterval(ch.timer); ch.close(); }
    }
    let ch = null;
    if (CT.RELAY_URL) {
      const open = () => {
        if (done) return;
        ws = new WebSocket(`${CT.RELAY_URL}/quick?id=${phoneId}`);
        ws.onopen = () => status('open');
        ws.onmessage = (e) => {
          let m = null;
          try { m = JSON.parse(e.data); } catch (err) { /* not for us */ }
          if (m && m.t === 'match' && /^[A-Z]{4}$/.test(m.code) && (m.role === 'host' || m.role === 'guest')) found({ code: m.code, role: m.role });
        };
        // closed without a match (the other phone vanished, or the
        // connection dropped): join the queue again
        ws.onerror = () => status('error');
        ws.onclose = () => { if (!done) retry = setTimeout(open, 2000); };
      };
      open();
    } else {
      // a tab's own id, so two tabs of one browser can pair
      const me = phoneId + Math.random().toString(36).slice(2, 8);
      ch = new BroadcastChannel('ct-quick');
      ch.onmessage = (e) => {
        const m = e.data || {};
        if (m.k === 'seek' && m.id !== me && me < m.id) {
          const code = makeCode();
          ch.postMessage({ k: 'match', to: m.id, code });
          found({ code, role: 'host' });
        } else if (m.k === 'match' && m.to === me) found({ code: m.code, role: 'guest' });
      };
      const say = () => ch.postMessage({ k: 'seek', id: me });
      ch.timer = setInterval(say, 1000);
      say();
      setTimeout(() => status('open'), 0);
    }
    return { close };
  }

  // An online player's profile: a name (16 letters at most) and a 32×32
  // picture (a PNG data URL), kept on the phone and sent to the other phone
  // when a match connects. Whatever arrives is checked again here, so a
  // made-up message can't put anything else on the other player's sign.
  const NAME_MAX = 16, PIC_SIDE = 32, PIC_MAX = 12000;
  function cleanProfile(p) {
    const name = p && typeof p.name === 'string'
      ? p.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
    const pic = p && typeof p.pic === 'string' && p.pic.length <= PIC_MAX && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(p.pic) ? p.pic : '';
    return { name, pic };
  }

  const lagParam = /[?&]lag=(\d+)/.exec(location.search);
  CT.Net = { connect, seekMatch, makeCode, cleanProfile, NAME_MAX, PIC_SIDE, createLagMeter, PING_EVERY, LAG, lag: lagParam ? +lagParam[1] : 0 };
})();
