'use strict';

const assert = require('assert');
const room_registry = require('../room_registry');

describe('room_registry', function() {
    it('should list rooms correctly when rooms are created', function() {
        const room1 = room_registry.createRoom('socket_host_1', 'Host 1');
        const list = room_registry.listRooms();
        
        assert(Array.isArray(list));
        assert(list.length >= 1);
        
        const found = list.find(r => r.roomCode === room1.roomCode);
        assert(found);
        assert.strictEqual(found.hostPlayerId, 'socket_host_1');
        assert.strictEqual(found.playerCount, 1);
        assert.strictEqual(found.status, 'LOBBY');
        assert.strictEqual(found.hasGameState, false);
    });

    it('should reset room back to lobby state', function() {
        const room = room_registry.createRoom('socket_host_reset', 'Host Reset');
        room.gameState = { turn: { playerId: 'socket_host_reset' } };
        room.status = 'IN_PROGRESS';
        room.seq = 12;

        const res = room_registry.resetRoom(room.roomCode);
        assert.strictEqual(res.room.status, 'LOBBY');
        assert.strictEqual(res.room.gameState, null);
        assert.strictEqual(res.room.seq, 0);
        assert.strictEqual(res.room.seats.length, 1);

        const errRes = room_registry.resetRoom('NONEXISTENT');
        assert.strictEqual(errRes.error, 'Room not found');
    });

    it('should delete room correctly', function() {
        const room = room_registry.createRoom('socket_host_del', 'Host Del');
        const code = room.roomCode;
        
        const res = room_registry.deleteRoom(code);
        assert.strictEqual(res.success, true);
        assert.strictEqual(room_registry.getRoom(code), undefined);

        const errRes = room_registry.deleteRoom(code);
        assert.strictEqual(errRes.error, 'Room not found');
    });

    it('should return detailed room view with toRoomDetail', function() {
        const room = room_registry.createRoom('socket_host_detail', 'Host Detail');
        room.gameState = { turn: { phase: 'ACTION', playerId: 'socket_host_detail' } };

        const detail = room_registry.toRoomDetail(room);
        assert.strictEqual(detail.roomCode, room.roomCode);
        assert.strictEqual(detail.playerCount, 1);
        assert.strictEqual(detail.connectedPlayerCount, 1);
        assert.strictEqual(detail.isFull, false);
        assert.strictEqual(detail.turnPhase, 'ACTION');
        assert.strictEqual(detail.hasGameState, true);
        assert.strictEqual(detail.spectatorCount, 0);
    });

    it('should expose remaining plays from the authoritative turn counter', function() {
        const room = room_registry.createRoom('socket_host_actions', 'Action Host');
        room.gameState = {
            turn: { playerId: 'socket_host_actions', playsMade: 1 },
            players: {
                socket_host_actions: { hand: [], bank: [], properties: {} }
            },
            drawPile: [],
            discardPile: []
        };

        const view = room_registry.toClientView(room, 'socket_host_actions');
        assert.strictEqual(view.actionCountRemaining, 2);
    });

    it('should project the authoritative draw phase and required draw count', function() {
        const room = room_registry.createRoom('socket_host_draw', 'Draw Host');
        room.gameState = {
            turn: { playerId: 'socket_host_draw', phase: 'DRAW', handSizeAtStartOfTurn: 0, playsMade: 0 },
            players: {
                socket_host_draw: { hand: [], bank: [], properties: {} }
            },
            drawPile: [],
            discardPile: []
        };

        const drawView = room_registry.toClientView(room, 'socket_host_draw');
        assert.strictEqual(drawView.turnPhase, 'DRAW');
        assert.strictEqual(drawView.drawCount, 5);

        room.gameState.turn.phase = 'ACTION';
        const actionView = room_registry.toClientView(room, 'socket_host_draw');
        assert.strictEqual(actionView.drawCount, null);
    });

    it('projects a public pending-charge summary while preserving debtor-only settlement details', function() {
        const room = room_registry.createRoom('charge-host', 'Charger');
        room_registry.joinRoom(room.roomCode, 'charge-debtor', 'Debtor');
        room_registry.joinRoom(room.roomCode, 'charge-observer', 'Observer');
        room.gameState = {
            turn: { playerId: 'charge-host', phase: 'ACTION', playsMade: 1 },
            players: {
                'charge-host': { hand: [], bank: [], properties: {} },
                'charge-debtor': { hand: [], bank: [], properties: {} },
                'charge-observer': { hand: [], bank: [], properties: {} }
            },
            drawPile: [],
            discardPile: [],
            pendingCharge: {
                sourceTitle: 'Debt Collector',
                fromPlayerId: 'charge-host',
                debtors: { 'charge-debtor': { amountOwed: 5 } }
            }
        };

        const chargerView = room_registry.toClientView(room, 'charge-host');
        const debtorView = room_registry.toClientView(room, 'charge-debtor');
        const observerView = room_registry.toClientView(room, 'charge-observer');
        const summary = {
            sourceTitle: 'Debt Collector',
            rentColor: null,
            fromPlayerId: 'charge-host',
            debtors: [{ playerId: 'charge-debtor', amountOwed: 5 }]
        };

        assert.deepStrictEqual(chargerView.pendingCharge, summary);
        assert.deepStrictEqual(debtorView.pendingCharge, summary);
        assert.deepStrictEqual(observerView.pendingCharge, summary);
        assert.strictEqual(chargerView.pendingResolution, undefined);
        assert.strictEqual(observerView.pendingResolution, undefined);
        assert.strictEqual(debtorView.pendingResolution.targetPlayerId, 'charge-debtor');
        assert.strictEqual(debtorView.pendingResolution.amountOwed, 5);
    });

    it('should compute server aggregate statistics via getStats', function() {
        const before = room_registry.getStats();
        const r1 = room_registry.createRoom('socket_st_1', 'Stat Player 1');
        const r2 = room_registry.createRoom('socket_st_2', 'Stat Player 2');
        r2.status = 'IN_PROGRESS';

        const after = room_registry.getStats();
        assert.strictEqual(after.activeRoomCount, before.activeRoomCount + 2);
        assert.strictEqual(after.totalPlayers, before.totalPlayers + 2);
        assert.strictEqual((after.statusBreakdown.IN_PROGRESS || 0), (before.statusBreakdown.IN_PROGRESS || 0) + 1);
    });
});
