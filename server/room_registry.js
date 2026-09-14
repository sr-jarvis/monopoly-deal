'use strict';

const game_manager = require('./game_manager');
const { checkWinCondition, getRequiredDrawCount } = require('./rules_validator');

// In-memory room registry
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

const MAX_SEATS = 5;

function createRoom(hostSocketId, displayName) {
    let roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
        roomCode = generateRoomCode();
    }

    const room = {
        roomCode,
        status: 'LOBBY',
        hostPlayerId: hostSocketId,
        seats: [
            {
                seatIndex: 0,
                playerId: hostSocketId,
                displayName: displayName || 'Player 1',
                connected: true
            }
        ],
        gameState: null,
        seq: 0
    };

    rooms.set(roomCode, room);
    return room;
}

function getRoom(roomCode) {
    return rooms.get(roomCode);
}

function joinRoom(roomCode, socketId, displayName) {
    const room = rooms.get(roomCode);
    if (!room) return { error: 'Room not found' };

    const existingSeat = room.seats.find(s => s.playerId === socketId);
    if (existingSeat) {
        existingSeat.connected = true;
        return { room };
    }

    if (room.seats.length >= 5) {
        return { error: 'Room is full' };
    }

    room.seats.push({
        seatIndex: room.seats.length,
        playerId: socketId,
        displayName: displayName || `Player ${room.seats.length + 1}`,
        connected: true
    });

    return { room };
}

function addBotSeat(roomCode, name = 'Jarvis Bot', difficulty = 'MEDIUM') {
    const code = (roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return { error: 'Room not found' };

    if (room.seats.length >= MAX_SEATS) {
        return { error: 'Room is full' };
    }

    const rawDiff = (difficulty && typeof difficulty === 'string') ? difficulty.toUpperCase() : 'MEDIUM';
    const normalizedDiff = rawDiff === 'BALANCED' ? 'MEDIUM' : rawDiff;

    const seatIndex = room.seats.length;
    const seat = {
        seatIndex,
        playerId: `bot:${code}:${seatIndex}`,
        displayName: name || 'Jarvis Bot',
        connected: true,
        isBot: true,
        difficulty: normalizedDiff
    };
    room.seats.push(seat);

    return { room, seat };
}

function toRoomState(room) {
    return {
        roomCode: room.roomCode,
        status: room.status,
        hostPlayerId: room.hostPlayerId,
        seats: room.seats.map(s => ({
            seatIndex: s.seatIndex,
            playerId: s.playerId,
            displayName: s.displayName,
            connected: s.connected,
            isBot: !!s.isBot,
            ...(s.isBot ? { difficulty: s.difficulty || 'MEDIUM' } : {})
        }))
    };
}

function flattenPropertyGroups(properties) {
    const flattened = {};
    Object.entries(properties || {}).forEach(([color, group]) => {
        if (Array.isArray(group)) {
            flattened[color] = group;
        } else if (group && Array.isArray(group.cards)) {
            flattened[color] = group.cards;
        } else {
            flattened[color] = [];
        }
    });
    return flattened;
}

// Additive, sparse view of which property groups carry a building. Only colors
// that actually have a House (or Hotel) appear as keys, so the wire shape of
// `properties` itself is untouched. Shape: { Green: { house: true }, ... }.
function extractBuildings(properties) {
    const buildings = {};
    Object.entries(properties || {}).forEach(([color, group]) => {
        if (!group || Array.isArray(group)) return;
        const entry = {};
        if (group.hasHouse) entry.house = true;
        if (group.hasHotel) entry.hotel = true;
        if (Object.keys(entry).length > 0) buildings[color] = entry;
    });
    return buildings;
}

function completedSetColorsFor(player) {
    const result = checkWinCondition(player || { properties: {} });
    return result && Array.isArray(result.completedSetColors) ? result.completedSetColors : [];
}

function toClientView(room, forPlayerId) {
    if (!room.gameState) return null;
    const gs = room.gameState;
    const playerKeys = Object.keys(gs.players);

    const selfPlayer = gs.players[forPlayerId] || { hand: [], bank: [], properties: {} };
    const opponents = playerKeys
        .filter(id => id !== forPlayerId)
        .map(id => {
            const p = gs.players[id];
            const seat = room.seats.find(s => s.playerId === id);
            return {
                id,
                displayName: seat ? seat.displayName : p.name,
                connected: seat ? seat.connected : true,
                isBot: seat ? !!seat.isBot : false,
                ...(seat && seat.isBot ? { difficulty: seat.difficulty || 'MEDIUM' } : {}),
                handCount: p.hand ? p.hand.length : 0,
                bank: p.bank || [],
                properties: flattenPropertyGroups(p.properties),
                buildings: extractBuildings(p.properties),
                completedSetColors: completedSetColorsFor(p)
            };
        });

    const view = {
        roomCode: room.roomCode,
        seq: room.seq,
        currentTurnPlayerId: gs.turn ? gs.turn.playerId : '',
        // The client must know when its authoritative turn is waiting on the
        // mandatory draw before it can offer playable cards or End Turn.
        turnPhase: gs.turn ? gs.turn.phase : null,
        drawCount: gs.turn && gs.turn.phase === 'DRAW'
            ? getRequiredDrawCount(gs.turn.handSizeAtStartOfTurn)
            : null,
        actionCountRemaining: gs.turn ? Math.max(0, 3 - (gs.turn.playsMade || 0)) : 0,
        drawPileCount: gs.drawPile ? gs.drawPile.length : 0,
        discardPileCount: gs.discardPile ? gs.discardPile.length : 0,
        self: {
            id: forPlayerId,
            hand: selfPlayer.hand || [],
            bank: selfPlayer.bank || [],
            properties: flattenPropertyGroups(selfPlayer.properties),
            buildings: extractBuildings(selfPlayer.properties),
            completedSetColors: completedSetColorsFor(selfPlayer)
        },
        opponents
    };

    // The debtor keeps the full settlement payload used by PaymentModal.
    const debtorEntry = gs.pendingCharge && gs.pendingCharge.debtors && gs.pendingCharge.debtors[forPlayerId];
    if (debtorEntry) {
        view.pendingResolution = {
            type: gs.pendingCharge.type || 'CHARGE',
            sourceTitle: gs.pendingCharge.sourceTitle,
            rentColor: gs.pendingCharge.rentColor || null,
            targetPlayerId: forPlayerId,
            amountOwed: debtorEntry.amountOwed,
            fromPlayerId: gs.pendingCharge.fromPlayerId
        };
    }

    // Charges are public actions and the rules block all players until they
    // settle. Project a deliberately small summary to every viewer so a
    // non-debtor can see why normal controls are unavailable without exposing
    // hidden cards or payment choices.
    if (gs.pendingCharge && gs.pendingCharge.debtors) {
        view.pendingCharge = {
            sourceTitle: gs.pendingCharge.sourceTitle,
            rentColor: gs.pendingCharge.rentColor || null,
            fromPlayerId: gs.pendingCharge.fromPlayerId,
            debtors: Object.entries(gs.pendingCharge.debtors).map(([playerId, entry]) => ({
                playerId,
                amountOwed: entry.amountOwed
            }))
        };
    }

    return view;
}

function listRooms() {
    return Array.from(rooms.values()).map(room => ({
        roomCode: room.roomCode,
        status: room.status,
        hostPlayerId: room.hostPlayerId,
        playerCount: room.seats.length,
        connectedCount: room.seats.filter(s => s.connected).length,
        seq: room.seq,
        hasGameState: !!room.gameState,
        currentTurnPlayerId: room.gameState && room.gameState.turn ? room.gameState.turn.playerId : null,
        seats: room.seats.map(s => ({
            seatIndex: s.seatIndex,
            playerId: s.playerId,
            displayName: s.displayName,
            connected: s.connected,
            isBot: !!s.isBot
        }))
    }));
}

function resetRoom(roomCode) {
    const code = (roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return { error: 'Room not found' };

    room.gameState = null;
    room.status = 'LOBBY';
    room.seq = 0;
    return { room };
}

function deleteRoom(roomCode) {
    const code = (roomCode || '').toUpperCase();
    if (!rooms.has(code)) return { error: 'Room not found' };
    rooms.delete(code);
    return { success: true };
}

function toRoomDetail(room) {
    const connectedPlayerCount = room.seats.filter(s => s.connected).length;
    return {
        ...toRoomState(room),
        playerCount: room.seats.length,
        connectedPlayerCount,
        isFull: room.seats.length >= MAX_SEATS,
        turnPhase: room.gameState && room.gameState.turn ? room.gameState.turn.phase : null,
        hasGameState: !!room.gameState,
        seq: room.seq,
        spectatorCount: 0
    };
}

function getStats() {
    const allRooms = Array.from(rooms.values());
    const statusBreakdown = {};
    let totalPlayers = 0;
    let totalConnectedPlayers = 0;
    allRooms.forEach(room => {
        statusBreakdown[room.status] = (statusBreakdown[room.status] || 0) + 1;
        totalPlayers += room.seats.length;
        totalConnectedPlayers += room.seats.filter(s => s.connected).length;
    });
    return { activeRoomCount: allRooms.length, totalPlayers, totalConnectedPlayers, statusBreakdown };
}

module.exports = {
    createRoom,
    getRoom,
    joinRoom,
    addBotSeat,
    toRoomState,
    toClientView,
    listRooms,
    resetRoom,
    deleteRoom,
    toRoomDetail,
    getStats,
    MAX_SEATS
};
