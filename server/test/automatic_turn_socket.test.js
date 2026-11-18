'use strict';
const assert = require('assert');
const client = require('socket.io-client');
const app = require('../app');
const registry = require('../room_registry');
const game = require('../game_manager');

const money = id => ({ id, kind: 'MONEY', title: '1M', value: 1 });
const action = (title, id) => ({ id, kind: 'ACTION', title, value: 3 });
const property = (color, id) => ({ id, kind: 'PROPERTY', title: id, color, type: color, value: 1 });
const group = (color, count) => ({ cards: Array.from({length: count}, (_, i) => property(color, `${color}-${i}`)), hasHouse: false, hasHotel: false });
function once(socket, event, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timeout: ${event}`)); }, 2000);
        function handler(data) { if (predicate(data)) { clearTimeout(timer); socket.off(event, handler); resolve(data); } }
        socket.on(event, handler);
    });
}
describe('Server-authoritative automatic turns (real sockets)', function () {
    this.timeout(10000);
    let url, sockets, room, peers, ids;
    before(done => app.http.listen(0, '127.0.0.1', () => { url = `http://127.0.0.1:${app.http.address().port}`; done(); }));
    after(done => app.http.close(done));
    beforeEach(async () => {
        sockets = []; peers = []; ids = [];
        for (let i = 0; i < 3; i++) {
            const socket = client(url, {forceNew: true, transports: ['websocket']}); sockets.push(socket);
            const session = await once(socket, 'session:ready'); peers.push(socket); ids.push(session.playerId);
        }
        let wait = once(peers[0], 'room:state'); peers[0].emit('room:create', {displayName:'A'});
        const lobby = await wait; room = registry.getRoom(lobby.roomCode);
        for (let i = 1; i < 3; i++) {
            wait = once(peers[0], 'room:state', r => r.seats.length === i + 1);
            peers[i].emit('room:join', {roomCode: room.roomCode, displayName: String(i)}); await wait;
        }
        wait = once(peers[0], 'game:state'); peers[0].emit('room:start'); await wait;
        fixture();
    });
    afterEach(() => { sockets.forEach(s => s.disconnect()); registry.deleteRoom(room.roomCode); });
    function fixture(playsMade = 2) {
        room.gameState = game.createGameState(ids.map(id => ({id, name:id})));
        for (const id of ids) room.gameState.players[id].hand = [money(`${id}-hand`)];
        room.gameState.drawPile = Array.from({length:20}, (_, i) => money(`draw-${i}`));
        room.gameState.discardPile = [];
        room.gameState.turn = {playerId:ids[0], phase:'ACTION', playsMade, hasDrawn:true, handSizeAtStartOfTurn:3};
    }
    async function act(index, payload) {
        const seq = room.seq;
        const wait = once(peers[0], 'game:state', state => state.seq > seq);
        peers[index].emit('game:action', payload); return wait;
    }
    function assertNext(state, index = 1, count = 2, eventId = 4) {
        assert.strictEqual(state.currentTurnPlayerId, ids[index]);
        assert.strictEqual(state.turnPhase, 'ACTION');
        assert.strictEqual(state.actionCountRemaining, 3);
        assert.strictEqual(state.turnNumber, 2);
        assert.deepStrictEqual(state.drawEvents.at(-1), {id:eventId, playerId:ids[index], count, kind:'DRAW'});
    }
    it('manual early End Turn auto-draws two; duplicate DRAW is rejected', async () => {
        fixture(0);
        const state = await act(0, {type:'END_TURN'}); assertNext(state);
        assert.strictEqual(room.gameState.players[ids[1]].hand.length, 3);
        const before = JSON.stringify(room.gameState);
        const rejected = once(peers[1], 'game:action-rejected'); peers[1].emit('game:action', {type:'DRAW', count:2});
        assert.match((await rejected).reason, /draw|phase/i); assert.strictEqual(JSON.stringify(room.gameState), before);
    });
    it('third play draws five for an empty next seat even when that seat disconnected', async () => {
        room.gameState.players[ids[1]].hand = [];
        const disconnected = once(peers[0], 'room:state', r => !r.seats[1].connected);
        peers[1].disconnect(); await disconnected;
        const state = await act(0, {type:'PLAY_CARD', cardId:`${ids[0]}-hand`, targetZone:'bank'});
        assertNext(state, 1, 5); assert.strictEqual(room.gameState.players[ids[1]].hand.length, 5);
    });
    it('last-action Pass Go draws before auto-end and records its exact separate draw', async () => {
        room.gameState.players[ids[0]].hand = [action('Pass Go','go')];
        const state = await act(0, {type:'PLAY_ACTION_CARD', cardId:'go'});
        assertNext(state, 1, 2, 5);
        assert.deepStrictEqual(state.drawEvents.slice(-2).map(e => [e.id,e.playerId,e.count,e.kind]), [[4,ids[0],2,'DRAW'],[5,ids[1],2,'DRAW']]);
        assert.strictEqual(state.self.hand.length,2);
    });
    it('waits above seven and advances on exactly the final discard, not another End Turn', async () => {
        room.gameState.players[ids[0]].hand = [action('Pass Go','go'), ...Array.from({length:8},(_,i)=>money(`keep-${i}`))];
        let state = await act(0, {type:'PLAY_ACTION_CARD', cardId:'go'});
        assert.strictEqual(state.turnPhase,'DISCARD'); assert.strictEqual(state.self.hand.length,10);
        assert.strictEqual(state.currentTurnPlayerId,ids[0]); assert.strictEqual(state.drawEvents.length,4);
        for (let i=0;i<2;i++) { state = await act(0,{type:'DISCARD',cardId:`keep-${i}`}); assert.strictEqual(state.currentTurnPlayerId,ids[0]); }
        state = await act(0,{type:'DISCARD',cardId:'keep-2'});
        assert.strictEqual(state.currentTurnPlayerId,ids[1]); assert.strictEqual(state.turnPhase,'ACTION'); assert.strictEqual(state.self.hand.length,7);
    });
    for (const title of ['Debt Collector', 'Its My Birthday', 'Rent']) {
        it(`third-action ${title} waits for every response and debtor`, async () => {
            const card = title === 'Rent' ? {id:'charge',kind:'RENT',title:'Rent',colors:['Brown','LightBlue'],value:1} : action(title,'charge');
            room.gameState.players[ids[0]].hand = [card];
            room.gameState.players[ids[0]].properties.Brown = group('Brown',1);
            let state = await act(0,{type:'PLAY_ACTION_CARD',cardId:'charge',targetPlayerId:ids[1],propertyColor:'Brown'});
            assert.strictEqual(state.currentTurnPlayerId,ids[0]); assert.ok(state.pendingActionResolution); assert.strictEqual(state.drawEvents.length,3);
            const debtors = title === 'Debt Collector' ? [1] : [1,2];
            for (const debtor of debtors) {
                state = await act(debtor,{type:'ACCEPT_ACTION'}); assert.strictEqual(state.currentTurnPlayerId,ids[0]);
            }
            for (const debtor of debtors) {
                state = await act(debtor,{type:'PAY_RENT',paymentCardIds:[]});
                if (debtor !== debtors.at(-1)) { assert.strictEqual(state.currentTurnPlayerId,ids[0]); assert.ok(state.pendingCharge); }
            }
            assertNext(state); assert.strictEqual(state.pendingCharge,undefined);
        });
    }
    for (const counter of [false,true]) {
        it(`third-action JSN ${counter ? 'counter restores debt' : 'cancellation ends turn'} only after chain acceptance`, async () => {
            room.gameState.players[ids[0]].hand = [action('Debt Collector','debt'), action('Just Say No','counter')];
            room.gameState.players[ids[1]].hand = [action('Just Say No','no')];
            await act(0,{type:'PLAY_ACTION_CARD',cardId:'debt',targetPlayerId:ids[1]});
            let state = await act(1,{type:'JUST_SAY_NO',cardId:'no'});
            assert.strictEqual(state.currentTurnPlayerId,ids[0]); assert.strictEqual(state.drawEvents.length,3);
            if (counter) {
                state = await act(0,{type:'JUST_SAY_NO',cardId:'counter'}); assert.strictEqual(state.currentTurnPlayerId,ids[0]);
                state = await act(1,{type:'ACCEPT_ACTION'}); assert.ok(state.pendingResolution === undefined); assert.ok(state.pendingCharge);
                state = await act(1,{type:'PAY_RENT',paymentCardIds:[]});
            } else state = await act(0,{type:'ACCEPT_ACTION'});
            assert.strictEqual(state.currentTurnPlayerId,ids[1]); assert.strictEqual(state.turnPhase,'ACTION');
            assert.strictEqual(state.drawEvents.at(-1).count,5);
        });
    }
    it('chained debts do not auto-end before the actual third play resolves', async () => {
        fixture(1); room.gameState.players[ids[0]].hand = [action('Debt Collector','d1'),action('Debt Collector','d2')];
        await act(0,{type:'PLAY_ACTION_CARD',cardId:'d1',targetPlayerId:ids[1]}); await act(1,{type:'ACCEPT_ACTION'});
        let state = await act(1,{type:'PAY_RENT',paymentCardIds:[]}); assert.strictEqual(state.currentTurnPlayerId,ids[0]);
        await act(0,{type:'PLAY_ACTION_CARD',cardId:'d2',targetPlayerId:ids[2]}); await act(2,{type:'ACCEPT_ACTION'});
        state = await act(2,{type:'PAY_RENT',paymentCardIds:[]}); assertNext(state);
    });
    it('Birthday JSN cancellation shields only that debtor and still waits for the other payment', async () => {
        room.gameState.players[ids[0]].hand = [action('Its My Birthday','birthday')];
        room.gameState.players[ids[1]].hand = [action('Just Say No','shield')];
        await act(0,{type:'PLAY_ACTION_CARD',cardId:'birthday'});
        await act(1,{type:'JUST_SAY_NO',cardId:'shield'});
        let state = await act(0,{type:'ACCEPT_ACTION'});
        assert.strictEqual(state.currentTurnPlayerId,ids[0]);
        assert.deepStrictEqual(state.pendingCharge.debtors.map(d=>d.playerId),[ids[2]]);
        assert.deepStrictEqual(state.pendingActionResolution.eligibleResponderIds,[ids[2]]);
        state = await act(2,{type:'ACCEPT_ACTION'}); assert.strictEqual(state.currentTurnPlayerId,ids[0]);
        state = await act(2,{type:'PAY_RENT',paymentCardIds:[]}); assertNext(state,1,5);
    });
    it('manual early End Turn with excess cards waits for the exact final discard', async () => {
        fixture(0);
        room.gameState.players[ids[0]].hand = Array.from({length:9},(_,i)=>money(`excess-${i}`));
        let state = await act(0,{type:'END_TURN'}); assert.strictEqual(state.turnPhase,'DISCARD');
        state = await act(0,{type:'DISCARD',cardId:'excess-0'}); assert.strictEqual(state.currentTurnPlayerId,ids[0]);
        const rejected = once(peers[0],'game:action-rejected'); peers[0].emit('game:action',{type:'END_TURN'});
        assert.match((await rejected).reason,/discard/i);
        state = await act(0,{type:'DISCARD',cardId:'excess-1'}); assertNext(state);
        const extraDiscard = once(peers[0],'game:action-rejected'); peers[0].emit('game:action',{type:'DISCARD',cardId:'excess-2'});
        await extraDiscard; assert.strictEqual(room.gameState.players[ids[0]].hand.length,7);
    });
    it('third-action property payment wins without advancing even if other Birthday debt remains', async () => {
        room.gameState.players[ids[0]].properties = {Brown:group('Brown',2),DarkBlue:group('DarkBlue',2),Utility:group('Utility',1)};
        room.gameState.players[ids[1]].properties = {Utility:{cards:[property('Utility','pay-win')]}};
        room.gameState.players[ids[0]].hand = [action('Its My Birthday','birthday-win')];
        await act(0,{type:'PLAY_ACTION_CARD',cardId:'birthday-win'}); await act(1,{type:'ACCEPT_ACTION'}); await act(2,{type:'ACCEPT_ACTION'});
        const over=once(peers[0],'game:over'); const state=await act(1,{type:'PAY_RENT',paymentCardIds:['pay-win']});
        assert.strictEqual((await over).winnerId,ids[0]); assert.strictEqual(state.currentTurnPlayerId,ids[0]);
        assert.strictEqual(state.drawEvents.length,3); assert.ok(state.pendingCharge);
    });
    it('accepted third-set Deal Breaker wins without advancing or drawing', async () => {
        room.gameState.players[ids[0]].properties = {Brown:group('Brown',2),DarkBlue:group('DarkBlue',2)};
        room.gameState.players[ids[1]].properties = {Utility:group('Utility',2)};
        room.gameState.players[ids[0]].hand = [action('Deal Breaker','win')];
        let state = await act(0,{type:'PLAY_ACTION_CARD',cardId:'win',targetPlayerId:ids[1],targetPropertyColor:'Utility'});
        assert.strictEqual(room.gameState.status,'IN_PROGRESS'); assert.strictEqual(state.drawEvents.length,3);
        const over = once(peers[0],'game:over'); state = await act(1,{type:'ACCEPT_ACTION'});
        assert.strictEqual((await over).winnerId,ids[0]); assert.strictEqual(state.currentTurnPlayerId,ids[0]);
        assert.strictEqual(state.drawEvents.length,3); assert.strictEqual(room.gameState.turnNumber,1);
    });
    it('ordinary third-set property win never auto-ends', async () => {
        room.gameState.players[ids[0]].properties = {Brown:group('Brown',2),DarkBlue:group('DarkBlue',2),Utility:group('Utility',1)};
        room.gameState.players[ids[0]].hand = [property('Utility','finish')];
        const over = once(peers[0],'game:over'); const state = await act(0,{type:'PLAY_CARD',cardId:'finish',targetZone:'properties',propertyColor:'Utility'});
        await over; assert.strictEqual(state.currentTurnPlayerId,ids[0]); assert.strictEqual(state.drawEvents.length,3);
    });
    it('human-to-bot third-action debt settles then bot plays and returns a drawn human turn', async () => {
        room.seats[1].isBot = true;
        // Empty bot hand means its automatic five draw contains only inert money.
        room.gameState.players[ids[1]].hand = [];
        room.gameState.players[ids[0]].hand = [action('Debt Collector','bot-debt')];
        const transport = require('../transport_game');
        const apply = transport.applyAction;
        const botAttempts = [];
        transport.applyAction = (state, payload) => {
            if (payload.playerId === ids[1]) botAttempts.push(payload.type);
            return apply(state, payload);
        };
        try {
            const final = once(peers[0],'game:state',s => s.turnNumber === 3 && s.currentTurnPlayerId === ids[2]);
            await act(0,{type:'PLAY_ACTION_CARD',cardId:'bot-debt',targetPlayerId:ids[1]});
            const state = await final; assert.strictEqual(state.turnPhase,'ACTION');
            assert.strictEqual(room.gameState.pendingCharge,null);
            assert.deepStrictEqual(state.drawEvents.slice(-2).map(e=>[e.playerId,e.count]),[[ids[1],5],[ids[2],2]]);
            assert.strictEqual(room.gameState.players[ids[1]].bank.length,3);
            assert.deepStrictEqual(botAttempts,['ACCEPT_ACTION','PAY_RENT','PLAY_CARD','PLAY_CARD','PLAY_CARD'], 'no stale planner END_TURN is attempted after automatic rotation');
        } finally { transport.applyAction = apply; }
    });
});

describe('Exact public draw metadata, without changing manual engine turns', () => {
    function state() { return game.createGameState([{id:'a',name:'A'},{id:'b',name:'B'}]); }
    function apply(s, a) { const result=game.applyAction(s,a); assert.ok(result.legal,result.reason); return result.gameState; }
    it('initial deal has one deterministic-count event per seat, unique match UUIDs and no private counter on wire', () => {
        const s=state(); assert.match(s.matchId,/^[0-9a-f]{8}-[0-9a-f-]{27}$/i); assert.notStrictEqual(s.matchId,state().matchId);
        assert.deepStrictEqual(s.drawEvents,[{id:1,playerId:'a',count:5,kind:'INITIAL'},{id:2,playerId:'b',count:5,kind:'INITIAL'}]);
        const room={roomCode:'TEST',gameState:s,seats:[],seq:0}; const view=registry.toClientView(room,'b');
        assert.strictEqual(view.matchId,s.matchId); assert.strictEqual(view.turnNumber,1); assert.deepStrictEqual(view.drawEvents,s.drawEvents);
        assert.strictEqual(view.drawEventCounter,undefined); assert.strictEqual(view.opponents[0].hand,undefined);
        assert.strictEqual(game.toClientView(s,'b').drawEventCounter,undefined);
    });
    it('records actual short/zero draws, reshuffle draws, and no event for rejected draws', () => {
        let s=state(); s.drawPile=[money('only')]; s.discardPile=[];
        s=apply(s,{type:'DRAW',playerId:'a',count:2}); assert.strictEqual(s.drawEvents.at(-1).count,1);
        const before=JSON.stringify(s); assert.strictEqual(game.applyAction(s,{type:'DRAW',playerId:'a',count:2}).legal,false); assert.strictEqual(JSON.stringify(s),before);
        s=apply(s,{type:'END_TURN',playerId:'a'}); assert.strictEqual(s.turn.phase,'DRAW');
        s=apply(s,{type:'DRAW',playerId:'b',count:2}); assert.strictEqual(s.drawEvents.at(-1).count,0);
        s=apply(s,{type:'END_TURN',playerId:'b'}); s.discardPile=[money('recycled')];
        s=apply(s,{type:'DRAW',playerId:'a',count:2}); assert.strictEqual(s.drawEvents.at(-1).count,1);
    });
    it('Pass Go records its actual one-card exhausted-pile draw, never a requested two', () => {
        let s=state(); s=apply(s,{type:'DRAW',playerId:'a',count:2});
        s.players.a.hand=[action('Pass Go','last-card')]; s.drawPile=[]; s.discardPile=[];
        s=apply(s,{type:'PLAY_ACTION_CARD',playerId:'a',cardId:'last-card'});
        assert.deepStrictEqual(s.drawEvents.at(-1),{id:4,playerId:'a',count:1,kind:'DRAW'});
        assert.strictEqual(s.players.a.hand.length,1);
        assert.deepStrictEqual(registry.toClientView({roomCode:'TEST',gameState:s,seats:[],seq:0},'b').drawEvents.at(-1),s.drawEvents.at(-1));
    });
    it('keeps only last 64 events while IDs strictly increase beyond truncation', () => {
        let s=state();
        for(let i=0;i<75;i++) { const playerId=s.turn.playerId; s.drawPile=[]; s.discardPile=[]; s=apply(s,{type:'DRAW',playerId,count:2}); s=apply(s,{type:'END_TURN',playerId}); }
        assert.strictEqual(s.drawEvents.length,64); assert.strictEqual(s.drawEvents[0].id,14); assert.strictEqual(s.drawEvents.at(-1).id,77);
        for(let i=1;i<s.drawEvents.length;i++) assert.strictEqual(s.drawEvents[i].id,s.drawEvents[i-1].id+1);
    });
});
