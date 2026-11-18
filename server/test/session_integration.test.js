'use strict';
const assert = require('assert');
const io = require('socket.io-client');
const app = require('../app');
const registry = require('../room_registry');
const game = require('../game_manager');
const once = (socket, event, predicate = () => true) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timeout: ${event}`)); }, 3000);
    function handler(data) { if (predicate(data)) { clearTimeout(timer); socket.off(event, handler); resolve(data); } }
    socket.on(event, handler);
});
describe('Human session and complete-match transport', function() {
    this.timeout(10000);
    let url, sockets = [];
    before(done => app.http.listen(0, '127.0.0.1', () => { url = `http://127.0.0.1:${app.http.address().port}`; done(); }));
    after(done => { sockets.forEach(s => s.disconnect()); app.http.close(done); });
    async function connect(token) {
        const s = io(url, { forceNew: true, transports: ['websocket'], auth: { sessionToken: token } });
        sockets.push(s);
        const session = await once(s, 'session:ready');
        return { s, session };
    }
    it('completes a real two-socket match, redacts hands, resumes exact seat, rejects forged identity and rematches', async () => {
        const a = await connect(), b = await connect();
        let wait = once(a.s, 'room:state'); a.s.emit('room:create', { displayName: 'A' });
        const lobby = await wait;
        wait = once(a.s, 'room:state', r => r.seats.length === 2); b.s.emit('room:join', { roomCode: lobby.roomCode, displayName: 'B' }); await wait;
        const room = registry.getRoom(lobby.roomCode);
        wait = once(a.s, 'game:state'); a.s.emit('room:start'); const initial = await wait;
        assert.strictEqual(initial.self.hand.length, 7);
        assert.strictEqual(initial.opponents[0].hand, undefined);
        assert.strictEqual(initial.drawPile, undefined);
        const rejected = once(b.s, 'game:action-rejected');
        b.s.emit('game:action', { type: 'PLAY_CARD', playerId: a.session.playerId, cardId: initial.self.hand[0].id, targetZone: 'bank' });
        assert.match((await rejected).reason, /current|turn/i);
        a.s.disconnect();
        const resumedSocket = io(url, { forceNew: true, transports: ['websocket'], auth: { sessionToken: a.session.sessionToken } }); sockets.push(resumedSocket);
        const resumed = await once(resumedSocket, 'game:state');
        assert.strictEqual(resumed.self.id, initial.self.id);
        assert.deepStrictEqual(resumed.self.hand.map(c => c.id), initial.self.hand.map(c => c.id));
        // Deterministic in-process fixture, never a production endpoint. Physical
        // catalog cards are dealt through real socket commands to a final win.
        const Deck = require('../models/Deck'); const deck = new Deck().cards;
        room.gameState = game.createGameState(room.seats.map(s => ({ id: s.playerId, name: s.displayName })));
        const idA = a.session.playerId, idB = b.session.playerId;
        const props = deck.filter(c => c.kind === 'PROPERTY' && ['Brown', 'DarkBlue', 'Utility'].includes(c.color || c.type));
        assert.strictEqual(props.length, 6);
        room.gameState.players[idA].hand = props;
        room.gameState.players[idB].hand = [];
        room.gameState.turn = { playerId: idA, phase: 'ACTION', playsMade: 0, hasDrawn: true, handSizeAtStartOfTurn: 6 };
        async function act(s, action) { const seq = room.seq; const update = once(s, 'game:state', state => state.seq > seq); s.emit('game:action', action); return update; }
        for (const card of props.slice(0,3)) await act(resumedSocket, { type: 'PLAY_CARD', cardId: card.id, targetZone: 'properties', propertyColor: card.color || card.type });
        // Third play automatically ends A's turn and draws B's empty-start five.
        assert.strictEqual(room.gameState.turn.playerId, idB);
        assert.strictEqual(room.gameState.turn.phase, 'ACTION');
        assert.strictEqual(room.gameState.players[idB].hand.length, 5);
        await act(b.s, { type: 'END_TURN' });
        assert.strictEqual(room.gameState.turn.playerId, idA);
        assert.strictEqual(room.gameState.turn.phase, 'ACTION');
        let over = once(resumedSocket, 'game:over');
        for (const card of props.slice(3)) await act(resumedSocket, { type: 'PLAY_CARD', cardId: card.id, targetZone: 'properties', propertyColor: card.color || card.type });
        assert.strictEqual((await over).winnerId, idA);
        wait = once(b.s, 'room:state', r => r.status === 'LOBBY'); resumedSocket.emit('room:rematch', { roomCode: lobby.roomCode }); await wait;
        assert.strictEqual(room.gameState, null);
        assert.strictEqual(room.seats.length, 2);
    });
    it('denies unseated reset/live-state advisor HTTP and malformed join without crashing', async () => {
        const {s} = await connect();
        const error = once(s, 'game:action-rejected'); s.emit('room:join', { roomCode: 123 });
        assert.match((await error).reason, /invalid/i);
        const fixture = registry.createRoom('reset-host', 'Reset fixture');
        fixture.gameState = game.createGameState([{id:'reset-host',name:'A'},{id:'reset-peer',name:'B'}]);fixture.status='IN_PROGRESS';
        const before = JSON.stringify(fixture.gameState);
        for (const suffix of ['reset','reset/','RESET','ReSeT/']) {
            const reset = await fetch(`${url}/api/monopoly/rooms/${fixture.roomCode}/${suffix}`, { method: 'POST' });
            assert.strictEqual(reset.status,403,suffix);assert.strictEqual(JSON.stringify(fixture.gameState),before,suffix);
        }
        registry.deleteRoom(fixture.roomCode);
        const advisor = await fetch(`${url}/api/monopoly/bot/decide-move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({roomId:'ABCD',playerSeat:'victim'}) }); assert.strictEqual(advisor.status,403);
        const health = await fetch(`${url}/healthz`); assert.strictEqual(health.status,200);
    });
});
