const ROOM_ID = 'default'; // only one implicit room exists today

function buildRoomsSnapshot(players, gameState, numOfPlayersToStart) {
    if (!players || players.length === 0) return [];

    const status = gameState
        ? 'IN_PROGRESS'
        : (players.length < (numOfPlayersToStart || 2) ? 'WAITING_FOR_PLAYERS' : 'STARTING');

    const currentTurn = gameState
        ? { playerId: gameState.turn.playerId, phase: gameState.turn.phase }
        : null;

    const deckCounts = gameState && gameState.drawPile
        ? { drawPileCount: gameState.drawPile.length, discardPileCount: gameState.discardPile ? gameState.discardPile.length : 0 }
        : null;

    return [{
        roomId: ROOM_ID,
        name: `${players[0].firstName || 'Unknown'}'s Game`, // synthesized — no real "name" concept exists
        playerCount: players.length,
        status,
        currentTurn,
        deckCounts
    }];
}

module.exports = { buildRoomsSnapshot };
