'use strict';
const assert = require('assert');
const io = require('socket.io-client');
const app = require('../app');
const registry = require('../room_registry');
const React = require('react');
const { loader } = require('./first_match_ui.test');
const once = (s, event, predicate = () => true) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off(event, handler); reject(new Error(`Timeout: ${event}`)); }, 2000);
    function handler(data) { if (predicate(data)) { clearTimeout(timer); s.off(event, handler); resolve(data); } }
    s.on(event, handler);
});
describe('Versioned room host match controls', function() {
    this.timeout(10000);
    let url, sockets = [], rooms = [];
    before(done => app.http.listen(0, '127.0.0.1', () => { url = `http://127.0.0.1:${app.http.address().port}`; done(); }));
    after(done => { sockets.forEach(s => s.disconnect()); rooms.forEach(r => registry.deleteRoom(r.roomCode)); app.http.close(done); });
    async function connect(token) {
        const s = io(url, { forceNew: true, transports: ['websocket'], auth: { sessionToken: token } });
        sockets.push(s); const session = await once(s, 'session:ready'); return { s, session };
    }
    async function fixture() {
        const a = await connect(), b = await connect();
        let wait = once(a.s, 'room:state'); a.s.emit('room:create', { displayName: 'Host' }); const lobby = await wait;
        const room = registry.getRoom(lobby.roomCode); rooms.push(room);
        wait = once(a.s, 'room:state', r => r.seats.length === 2); b.s.emit('room:join', { roomCode: room.roomCode, displayName: 'Peer' }); await wait;
        wait = once(a.s, 'game:state'); a.s.emit('room:start'); await wait;
        return { a, b, room };
    }
    const manage = (s, data) => new Promise((resolve, reject) => s.timeout(1500).emit('room:manage', data, (err, result) => err ? reject(err) : resolve(result)));
    it('closes active rematch and unversioned reset bypasses', async () => {
        const { a, b, room } = await fixture(); const original = room.gameState;
        // Resync provides a round-trip barrier without depending on a rejection event.
        for (const [s, event, payload] of [[b.s, 'room:rematch', {}], [b.s, 'room:reset', {}], [a.s, 'room:reset', {}]]) {
            s.emit(event, payload); const wait = once(s, 'room:state'); s.emit('game:resync'); await wait;
            assert.strictEqual(room.gameState, original, `${event} must not reset an active match without host + version`);
        }
    });
    it('ends without a winner, preserves seats, resyncs null and rejects duplicate after a new start', async () => {
        const { a, b, room } = await fixture(); const seats = JSON.stringify(room.seats); let winners = 0;
        a.s.on('game:over', () => winners++); b.s.on('game:over', () => winners++);
        const request = { operation: 'end', roomCode: room.roomCode, matchId: room.gameState.matchId };
        const both = [once(a.s, 'game:state', s => s === null), once(b.s, 'game:state', s => s === null)];
        assert.deepStrictEqual(await manage(a.s, request), { ok: true }); await Promise.all(both);
        assert.strictEqual(room.status, 'LOBBY'); assert.strictEqual(room.gameState, null); assert.strictEqual(JSON.stringify(room.seats), seats);
        let wait = once(b.s, 'game:state', s => s === null); b.s.emit('game:resync'); await wait;
        wait = once(a.s, 'game:state'); a.s.emit('room:start'); await wait; const next = room.gameState;
        assert.strictEqual((await manage(a.s, request)).ok, false); assert.strictEqual(room.gameState, next); assert.strictEqual(winners, 0);
    });
    it('restarts with fresh redacted 7/5 hands and startup events, clears pending state and rejects stale writes', async () => {
        const { a, b, room } = await fixture(); const seats = JSON.stringify(room.seats);
        const request = { operation: 'restart', roomCode: room.roomCode, matchId: room.gameState.matchId };
        room.gameState.pendingCharge = { debtors: {} }; room.gameState.pendingActionResolution = { sourceTitle: 'Just Say No' }; room.gameState.turn.phase = 'DISCARD';
        const states = [once(a.s, 'game:state', s => s?.matchId !== request.matchId), once(b.s, 'game:state', s => s?.matchId !== request.matchId)]; const seq = room.seq; const start = once(a.s, 'game:event', e => e.action === 'START' && e.seq > seq);
        assert.deepStrictEqual(await manage(a.s, request), { ok: true }); const [host, peer] = await Promise.all(states); await start;
        assert.notStrictEqual(host.matchId, request.matchId); assert.strictEqual(host.matchId, peer.matchId);
        assert.strictEqual(host.self.hand.length, 7); assert.strictEqual(peer.self.hand.length, 5); assert.strictEqual(host.opponents[0].hand, undefined); assert.strictEqual(peer.opponents[0].hand, undefined); assert.strictEqual(host.drawPile, undefined);
        assert.strictEqual(host.turnPhase, 'ACTION'); assert.ok(host.drawEvents.some(e => e.kind === 'INITIAL')); assert.ok(host.drawEvents.some(e => e.kind === 'DRAW'));
        assert.ok(!room.gameState.pendingCharge); assert.ok(!room.gameState.pendingActionResolution); assert.strictEqual(JSON.stringify(room.seats), seats);
        const next = room.gameState; assert.strictEqual((await manage(a.s, request)).ok, false); assert.strictEqual(room.gameState, next);
    });
    it('denies nonhosts, outsiders, other rooms, forged identity and invalid payloads without mutation', async () => {
        const { a, b, room } = await fixture(); const outsider = await connect(); const other = await fixture(); const original = room.gameState;
        const valid = { operation: 'end', roomCode: room.roomCode, matchId: original.matchId };
        for (const [s, data] of [[b.s, valid], [outsider.s, valid], [other.a.s, valid], [b.s, { ...valid, playerId: a.session.playerId }], [a.s, null], [a.s, []], [a.s, 'end'], [a.s, {}], [a.s, { ...valid, operation: 'delete' }], [a.s, { ...valid, matchId: 3 }], [a.s, { ...valid, roomCode: 3 }], [a.s, { ...valid, matchId: 'stale' }]]) {
            const result = await manage(s, data); assert.strictEqual(result.ok, false); assert.strictEqual(typeof result.reason, 'string'); assert.strictEqual(room.gameState, original);
        }
    });
    it('accepts recovered host session and finished matches; preserves seated finished rematch', async () => {
        const { a, b, room } = await fixture(); a.s.disconnect(); const recovered = await connect(a.session.sessionToken);
        room.status = 'FINISHED'; room.gameState.status = 'FINISHED';
        assert.strictEqual((await manage(recovered.s, { operation: 'restart', roomCode: room.roomCode, matchId: room.gameState.matchId })).ok, true);
        room.status = 'FINISHED'; room.gameState.status = 'FINISHED';
        const wait = once(b.s, 'game:state', s => s === null); b.s.emit('room:rematch', { roomCode: room.roomCode }); await wait; assert.strictEqual(room.status, 'LOBBY');
        const response = await fetch(`${url}/api/monopoly/rooms/${room.roomCode}/reset`, { method: 'POST' }); assert.strictEqual(response.status, 403);
    });
    it('UI cancellation emits nothing; confirmation captures version, serializes double clicks and resyncs uncertain writes', () => {
        const hooks = []; let index = 0; const emitted = []; let acknowledgement;
        const socket = { connected: true, get volatile() { return this; }, timeout(ms) { assert.strictEqual(ms, 5000); return this; }, emit(event, data, callback) { emitted.push([event, data]); acknowledgement = callback; } };
        const fakeReact = { ...React,
            useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
            useRef(initial) { const i = index++; return hooks[i] ||= { current: initial }; },
            useEffect() {}, useSyncExternalStore() { return true; }
        };
        const load = loader({ react: fakeReact, '../net/socket': { socketService: { getSocket: () => socket, emit: (...args) => emitted.push(args) } } });
        const { GameSettings } = load('client/src/components/GameSettings.tsx');
        let props = { onLeaderboard() {}, hostMatch: { roomCode: 'ABCD', matchId: 'old-match' } };
        function render() { index = 0; const nodes = []; const walk = node => { if (!node || typeof node !== 'object') return; nodes.push(node); React.Children.forEach(node.props?.children, walk); }; walk(GameSettings(props)); return nodes; }
        const button = (nodes, name) => nodes.find(n => n.type === 'button' && n.props.children === name);
        let nodes = render(); button(nodes, 'End match').props.onClick(); nodes = render(); button(nodes, 'Cancel').props.onClick(); assert.strictEqual(emitted.length, 0);
        nodes = render(); button(nodes, 'Restart match').props.onClick(); nodes = render();
        nodes.find(n => n.type === 'dialog').props.onCancel({ preventDefault() {} }); assert.strictEqual(emitted.length, 0);
        nodes = render(); button(nodes, 'Restart match').props.onClick();
        props = { ...props, hostMatch: { roomCode: 'ABCD', matchId: 'new-match' } }; nodes = render();
        const confirm = button(nodes, 'Confirm restart match'); confirm.props.onClick(); confirm.props.onClick();
        assert.deepStrictEqual(emitted, [['room:manage', { operation: 'restart', roomCode: 'ABCD', matchId: 'old-match' }]]);
        acknowledgement(new Error('timeout')); confirm.props.onClick(); assert.strictEqual(emitted.length, 2, 'old closure cannot retry before rerender'); nodes = render();
        assert.ok(nodes.some(n => n.props?.role === 'alert' && n.props.children.includes('may have changed')));
        assert.deepStrictEqual(emitted[1], ['game:resync']);
        button(nodes, 'Confirm restart match').props.onClick(); assert.strictEqual(emitted.length, 2, 'no blind retry after ambiguous write');
        props = { onLeaderboard() {} }; button(nodes, 'Cancel').props.onClick(); nodes = render();
        assert.strictEqual(button(nodes, 'End match'), undefined, 'nonhost gets no controls');
    });
});
