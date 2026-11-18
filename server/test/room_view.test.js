const { expect } = require("chai");
const room_view = require("../room_view");
const game_manager = require("../game_manager");

describe("room_view", () => {
    describe("buildRoomsSnapshot", () => {
        it("should return empty array if no players are active", () => {
            const result = room_view.buildRoomsSnapshot([], null, 2);
            expect(result).to.deep.equal([]);
        });

        it("should return WAITING_FOR_PLAYERS status if player count is under threshold", () => {
            const players = [{ firstName: "Scott", lastName: "Russell", id: "socket1" }];
            const result = room_view.buildRoomsSnapshot(players, null, 2);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).to.deep.include({
                roomId: "default",
                name: "Scott's Game",
                playerCount: 1,
                status: "WAITING_FOR_PLAYERS",
                currentTurn: null,
                deckCounts: null
            });
        });

        it("should return IN_PROGRESS and show gameState information when gameState is active", () => {
            const players = [
                { id: "socket1", name: "Scott Russell", firstName: "Scott", lastName: "Russell" },
                { id: "socket2", name: "Shuri Builder", firstName: "Shuri", lastName: "Builder" }
            ];
            
            const formattedPlayers = players.map(p => ({
                id: p.id,
                name: p.firstName + " " + p.lastName
            }));
            
            const gameState = game_manager.createGameState(formattedPlayers);
            const result = room_view.buildRoomsSnapshot(players, gameState, 2);
            
            expect(result).to.have.lengthOf(1);
            expect(result[0].status).to.equal("IN_PROGRESS");
            expect(result[0].playerCount).to.equal(2);
            expect(result[0].currentTurn).to.not.be.null;
            expect(result[0].currentTurn.playerId).to.equal(gameState.turn.playerId);
            expect(result[0].deckCounts).to.not.be.null;
            expect(result[0].deckCounts.drawPileCount).to.equal(96); // 106 playable cards minus 10 dealt cards (5 each)
            expect(result[0].deckCounts.discardPileCount).to.equal(0);
        });
    });
});
