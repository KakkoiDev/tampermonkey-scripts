// ==UserScript==
// @name         Trystero P2P Playground
// @namespace    http://tampermonkey.net/
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="5" cy="12" r="3" fill="%234f46e5"/><circle cx="19" cy="6" r="3" fill="%234f46e5"/><circle cx="19" cy="18" r="3" fill="%234f46e5"/><path d="M7 11l9-4M7 13l9 4" stroke="%234f46e5" stroke-width="2"/></svg>
// @version      2026.07.23.1
// @description  Console-driven WebRTC P2P playground (trystero/Nostr): origin-independent id, join a room, message peers. A base for real-time apps
// @author       KakkoiDev
// @match        *://*/*
// @run-at       document-idle
// @sandbox      raw
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

// Design notes:
// - @sandbox raw keeps the script in the page's MAIN world, so runtime import() of an ES module
//   works (same as @grant none). @grant GM_setValue/GM_getValue give storage that is shared across
//   ALL origins, so the user id and room are the same on every site (localStorage would be per-origin).
// - trystero's own selfId is read-only and cannot be set, so "user id" is our own layer: a persisted
//   string exchanged over the reserved 'id' action and mapped to trystero peerIds.
// - trystero has no "who is in the room" query, so listRoomUsers() is built from onPeerJoin/onPeerLeave
//   plus the presence exchange.
// - CSP: the script loads everywhere its injection is allowed, but peers only actually connect where the
//   page's connect-src permits the signaling WebSocket (wss to Nostr relays). Strict-CSP sites
//   (GitHub/Notion/Google) need Tampermonkey's "Modify existing CSP headers" setting enabled.
// - Reserved trystero action names: 'msg' and 'id'. Keep custom action names short (trystero caps them).

(function () {
    'use strict';

    const DEBUG = false;

    const APP_ID = 'tms-p2p-playground';
    const TRYSTERO_URL = 'https://esm.sh/trystero@0.25.3';
    const K_USER = 'tms:p2p:userId';
    const K_ROOM = 'tms:p2p:roomId';
    const MSG_ACTION = 'msg';
    const ID_ACTION = 'id';

    const state = {
        userId: null,
        roomId: null,
        room: null,          // trystero room object
        mod: null,           // cached trystero module
        joining: null,       // in-flight join() promise (guard)
        peers: new Map(),    // peerId -> { userId }
        actions: new Map(),  // actionName -> { action: {send,onMessage}, handlers: [] }
        msgHandlers: [],     // fns registered via onMessage()
        debug: false,
    };

    const log = (...a) => { if (state.debug || DEBUG) console.log('[p2p]', ...a); };
    const warn = (...a) => { if (state.debug || DEBUG) console.warn('[p2p]', ...a); };

    // --- storage (GM => shared across every origin) ---------------------------
    function load(key, fallback) {
        try {
            const v = GM_getValue(key);
            return (v === undefined || v === null) ? fallback : v;
        } catch (e) { return fallback; }
    }
    function store(key, value) {
        try { GM_setValue(key, value); } catch (e) { warn('GM_setValue failed', e); }
    }

    function randomId() {
        let rnd;
        try {
            rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            rnd = Math.random().toString(36).slice(2, 10);
        }
        return 'user-' + rnd;
    }

    // --- trystero module (lazy: only fetched on first join) -------------------
    async function loadTrystero() {
        if (state.mod) return state.mod;
        state.mod = await import(TRYSTERO_URL);
        return state.mod;
    }

    // --- actions --------------------------------------------------------------
    // trystero: room.makeAction(name) -> { send, onMessage }. onMessage is a settable
    // single-handler property, so we own a dispatcher and fan out to our handler list.
    function ensureAction(name) {
        if (!state.room) { console.warn('[p2p] not in a room - call p2p.setRoomId("my-room") first'); return null; }
        let a = state.actions.get(name);
        if (!a) {
            const action = state.room.makeAction(name);
            a = { action, handlers: [] };
            action.onMessage = (data, meta) => {
                const peerId = meta && meta.peerId;
                const userId = (state.peers.get(peerId) || {}).userId || peerId;
                for (const h of a.handlers) {
                    try { h(data, { peerId, userId, meta }); } catch (e) { warn('action handler threw', e); }
                }
            };
            state.actions.set(name, a);
        }
        return a;
    }

    function on(name, fn) {
        if (typeof fn !== 'function') { console.warn('[p2p] on(action, fn) needs a function'); return () => {}; }
        const a = ensureAction(name);
        if (!a) return () => {};
        a.handlers.push(fn);
        return () => { a.handlers = a.handlers.filter((h) => h !== fn); };
    }

    function emit(name, data, target) {
        const a = ensureAction(name);
        if (!a) return;
        a.action.send(data, target != null ? { target } : undefined);
    }

    // --- room lifecycle -------------------------------------------------------
    async function join(roomId) {
        roomId = roomId || state.roomId;
        if (!roomId) { console.warn('[p2p] no room set - call p2p.setRoomId("my-room")'); return null; }
        if (state.room && state.roomId === roomId) return state.room;
        if (state.joining) return state.joining;

        if (state.room) leave();            // switching rooms
        state.roomId = roomId;
        store(K_ROOM, roomId);

        state.joining = (async () => {
            let mod;
            try {
                mod = await loadTrystero();
            } catch (e) {
                warn('could not load trystero - the page CSP likely blocks it. Details:', e);
                return null;
            }

            const room = mod.joinRoom({ appId: APP_ID }, roomId);
            state.room = room;
            state.peers.clear();
            state.actions.clear();

            // presence: exchange our user id, map it to trystero peerIds
            on(ID_ACTION, (data, meta) => {
                if (data && data.userId) {
                    state.peers.set(meta.peerId, { userId: data.userId });
                    log('peer id', meta.peerId, '->', data.userId);
                }
            });

            // chat: print every incoming message, then fan out to onMessage() handlers
            on(MSG_ACTION, (data, meta) => {
                const text = (data && typeof data === 'object' && 'text' in data) ? data.text : data;
                console.log(`[p2p] ${meta.userId}: ${text}`);
                for (const h of state.msgHandlers) {
                    try { h(text, meta); } catch (e) { warn('onMessage handler threw', e); }
                }
            });

            room.onPeerJoin = (peerId) => {
                log('peer join', peerId);
                emit(ID_ACTION, { userId: state.userId }, peerId);   // tell the newcomer who we are
            };
            room.onPeerLeave = (peerId) => {
                log('peer leave', peerId);
                state.peers.delete(peerId);
            };

            log('joined', roomId, 'as', state.userId, '| selfId', mod.selfId);
            return room;
        })();

        try { return await state.joining; }
        finally { state.joining = null; }
    }

    function leave() {
        if (state.room) { try { state.room.leave(); } catch (e) { warn('leave() threw', e); } }
        state.room = null;
        state.peers.clear();
        state.actions.clear();
        log('left room');
    }

    function forget() {
        leave();
        state.roomId = null;
        store(K_ROOM, null);
        log('forgot room (auto-join disabled)');
    }

    // --- identity -------------------------------------------------------------
    function setUserId(id) {
        if (!id || typeof id !== 'string') { console.warn('[p2p] setUserId(id) needs a non-empty string'); return state.userId; }
        state.userId = id;
        store(K_USER, id);
        if (state.room) emit(ID_ACTION, { userId: id });   // re-announce to peers
        log('userId set to', id);
        return id;
    }
    function setRandomId() { return setUserId(randomId()); }
    function getUserId() { return state.userId; }
    function whoami() {
        console.log(`[p2p] you are "${state.userId}" | room: ${state.roomId || '(none)'} | joined: ${!!state.room}`);
        return state.userId;
    }
    function selfId() { return state.mod ? state.mod.selfId : null; }

    // --- messaging ------------------------------------------------------------
    function sendMessage(text) {
        if (!state.room) { console.warn('[p2p] join a room first - p2p.setRoomId("my-room")'); return; }
        emit(MSG_ACTION, { text: String(text), from: state.userId, ts: Date.now() });
    }
    function send(data, target) {
        if (!state.room) { console.warn('[p2p] join a room first - p2p.setRoomId("my-room")'); return; }
        emit(MSG_ACTION, data, target);
    }
    function onMessage(fn) {
        if (typeof fn !== 'function') { console.warn('[p2p] onMessage(fn) needs a function'); return () => {}; }
        state.msgHandlers.push(fn);
        return () => { state.msgHandlers = state.msgHandlers.filter((h) => h !== fn); };
    }

    // --- presence -------------------------------------------------------------
    function listRoomUsers() {
        const self = { userId: state.userId, peerId: null, self: true };
        const others = [...state.peers.entries()].map(([peerId, v]) => ({ userId: v.userId, peerId, self: false }));
        return [self, ...others];
    }
    function listPeers() {
        return state.room ? Object.keys(state.room.getPeers()) : [];
    }
    function ping(peerId) {
        if (!state.room) { console.warn('[p2p] join a room first'); return Promise.reject(new Error('not in a room')); }
        return state.room.ping(peerId);
    }

    // --- meta -----------------------------------------------------------------
    function status() {
        return {
            userId: state.userId,
            roomId: state.roomId,
            joined: !!state.room,
            peers: state.peers.size,
            selfId: selfId(),
            debug: state.debug,
        };
    }
    function relays() {
        // getRelaySockets is only exported by some strategies (not the default nostr entry),
        // so this may be empty. It is a best-effort signaling diagnostic.
        const m = state.mod;
        if (m && typeof m.getRelaySockets === 'function') {
            try { return m.getRelaySockets(); } catch (e) { return {}; }
        }
        return {};
    }

    // Open a permissive page in a new tab, where CSP lets P2P actually connect. If a room is
    // stored, the script auto-joins it there. Not a CSP bypass - just a jump to a clean origin.
    function openTab(url) {
        url = url || 'https://example.com/';
        if (typeof GM_openInTab === 'function') {
            GM_openInTab(url, { active: true, insert: true, setParent: true });
        } else if (typeof window.open === 'function') {
            warn('GM_openInTab unavailable, falling back to window.open (may be popup-blocked)');
            window.open(url, '_blank');
        }
        return url;
    }

    function help() {
        const lines = [
            'Trystero P2P Playground - console commands (all under p2p.*)',
            '',
            'Quickstart:',
            '  p2p.setRandomId()            give yourself a random id (persists across every site)',
            '  p2p.setRoomId("my-room")     join a room (auto-rejoins on every page load)',
            '  p2p.sendMessage("hi")        broadcast a chat message to the room',
            '  p2p.listRoomUsers()          see who else is here',
            '',
            'Identity:',
            '  setUserId(id)      set your id (string, shared across every site)',
            '  setRandomId()      set a random id',
            '  getUserId()        -> your id',
            '  whoami()           print id + room + joined state',
            "  selfId()           -> trystero's internal peer id (read-only)",
            '',
            'Room:',
            '  setRoomId(room)    persist + join a room',
            '  getRoomId()        -> current room id',
            '  join(room?)        join (defaults to the stored room)',
            '  leave()            leave now (room stays stored, rejoins on reload)',
            '  forget()           leave and clear the stored room (stops auto-join)',
            '',
            'Messaging:',
            '  sendMessage(text)         broadcast a chat message',
            '  send(data, target?)       send arbitrary data (target = peerId or [peerIds]; omit = broadcast)',
            '  onMessage(fn)             fn(text, {peerId,userId}) per incoming message; returns unsubscribe',
            '',
            'Custom actions (build your own real-time app on top):',
            '  on(action, fn)            fn(data, {peerId,userId}) for a named action; returns unsubscribe',
            '  emit(action, data, t?)    send on a named action (t = peerId or [peerIds]; omit = broadcast)',
            '  room()                    -> raw trystero room object',
            '  module()                  -> raw trystero module',
            '  reserved action names: "msg", "id". Keep custom names short (trystero caps length).',
            '',
            'Presence:',
            '  listRoomUsers()    -> [{userId, peerId, self}] (you + known peers)',
            '  listPeers()        -> [peerId] raw trystero peers',
            '  ping(peerId)       -> Promise<ms>',
            '',
            'Meta:',
            '  status()           -> {userId, roomId, joined, peers, selfId, debug}',
            '  relays()           -> open signaling sockets (may be empty on the nostr backend)',
            '  openTab(url?)      open a permissive page in a new tab (default example.com) where P2P can connect',
            '  debug = true       verbose logging + surface load/CSP errors',
            '  help()             this text',
        ];
        console.log(lines.join('\n'));
    }

    // --- public API on window (raw MAIN world => reachable from the page console)
    const api = {
        setUserId, setRandomId, getUserId, whoami, selfId,
        setRoomId: (roomId) => (roomId && typeof roomId === 'string')
            ? join(roomId)
            : (console.warn('[p2p] setRoomId(room) needs a non-empty string'), undefined),
        getRoomId: () => state.roomId,
        join, leave, forget,
        sendMessage, send, onMessage,
        on, emit,
        room: () => state.room,
        module: () => state.mod,
        listRoomUsers, listPeers, ping,
        status, relays, openTab, help,
    };
    Object.defineProperty(api, 'debug', {
        get() { return state.debug; },
        set(v) { state.debug = !!v; },
        enumerable: true,
    });

    // --- boot -----------------------------------------------------------------
    state.userId = load(K_USER, null);
    if (!state.userId) { state.userId = randomId(); store(K_USER, state.userId); }
    state.roomId = load(K_ROOM, null);

    // expose on the page's REAL window so the page console can see it (raw/sandbox differences)
    const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    pageWindow.p2p = api;

    if (state.roomId) { join(state.roomId).catch(() => {}); }   // participate on every page
    log('ready. p2p.help() for commands. id:', state.userId, '| room:', state.roomId || '(none)');
})();
