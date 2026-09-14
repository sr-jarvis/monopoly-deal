'use strict';

const assert = require('assert');
const turn_planner = require('../turn_planner');
const game_manager = require('../game_manager');
const card_effects = require('../card_effects');
const app = require('../app');

describe('Solo-Bot Building Cards — House & Hotel', function() {
  function createTestState() {
    return {
      status: 'IN_PROGRESS',
      seq: 1,
      turnNumber: 1,
      drawPile: [],
      discardPile: [],
      turnOrder: ['bot1', 'p2'],
      turn: {
        playerId: 'bot1',
        phase: 'ACTION',
        playsMade: 0,
        handSizeAtStartOfTurn: 5,
        hasDrawn: true
      },
      players: {
        bot1: {
          id: 'bot1',
          name: 'Jarvis Bot',
          hand: [],
          bank: [],
          properties: {}
        },
        p2: {
          id: 'p2',
          name: 'Human Player',
          hand: [],
          bank: [],
          properties: {}
        }
      }
    };
  }

  describe('selectBuildingCardPlay', function() {
    it('selects House for an owned complete property set without a House', function() {
      const state = createTestState();
      const houseCard = { id: 'house_1', title: 'House', type: 'action', value: 3 };
      state.players.bot1.hand = [houseCard];
      state.players.bot1.properties = {
        DarkBlue: {
          cards: [
            { id: 'db1', name: 'Boardwalk', color: 'DarkBlue', value: 4 },
            { id: 'db2', name: 'Park Place', color: 'DarkBlue', value: 4 }
          ],
          hasHouse: false,
          hasHotel: false
        }
      };

      const result = turn_planner.selectBuildingCardPlay(state, 'bot1');
      assert(result);
      assert.strictEqual(result.type, 'PLAY_ACTION_CARD');
      assert.strictEqual(result.cardId, 'house_1');
      assert.strictEqual(result.propertyColor, 'DarkBlue');
    });

    it('selects Hotel for an owned complete set that already has a House', function() {
      const state = createTestState();
      const hotelCard = { id: 'hotel_1', title: 'Hotel', type: 'action', value: 4 };
      state.players.bot1.hand = [hotelCard];
      state.players.bot1.properties = {
        Brown: {
          cards: [
            { id: 'br1', name: 'Baltic', color: 'Brown', value: 1 },
            { id: 'br2', name: 'Mediterranean', color: 'Brown', value: 1 }
          ],
          hasHouse: true,
          hasHotel: false
        }
      };

      const result = turn_planner.selectBuildingCardPlay(state, 'bot1');
      assert(result);
      assert.strictEqual(result.type, 'PLAY_ACTION_CARD');
      assert.strictEqual(result.cardId, 'hotel_1');
      assert.strictEqual(result.propertyColor, 'Brown');
    });

    it('returns null for an incomplete property set', function() {
      const state = createTestState();
      const houseCard = { id: 'house_1', title: 'House', type: 'action', value: 3 };
      state.players.bot1.hand = [houseCard];
      state.players.bot1.properties = {
        DarkBlue: {
          cards: [{ id: 'db1', name: 'Boardwalk', color: 'DarkBlue', value: 4 }],
          hasHouse: false
        }
      };

      const result = turn_planner.selectBuildingCardPlay(state, 'bot1');
      assert.strictEqual(result, null);
    });

    it('returns null for excluded sets like Railroad or Utility', function() {
      const state = createTestState();
      const houseCard = { id: 'house_1', title: 'House', type: 'action', value: 3 };
      state.players.bot1.hand = [houseCard];
      state.players.bot1.properties = {
        Railroad: {
          cards: [
            { id: 'rr1', name: 'B&O', color: 'Railroad', value: 2 },
            { id: 'rr2', name: 'Reading', color: 'Railroad', value: 2 },
            { id: 'rr3', name: 'Pennsylvania', color: 'Railroad', value: 2 },
            { id: 'rr4', name: 'Short Line', color: 'Railroad', value: 2 }
          ],
          hasHouse: false
        }
      };

      const result = turn_planner.selectBuildingCardPlay(state, 'bot1');
      assert.strictEqual(result, null);
    });

    it('returns null if the complete set already has both House and Hotel', function() {
      const state = createTestState();
      const houseCard = { id: 'house_1', title: 'House', type: 'action', value: 3 };
      const hotelCard = { id: 'hotel_1', title: 'Hotel', type: 'action', value: 4 };
      state.players.bot1.hand = [houseCard, hotelCard];
      state.players.bot1.properties = {
        DarkBlue: {
          cards: [
            { id: 'db1', name: 'Boardwalk', color: 'DarkBlue', value: 4 },
            { id: 'db2', name: 'Park Place', color: 'DarkBlue', value: 4 }
          ],
          hasHouse: true,
          hasHotel: true
        }
      };

      const result = turn_planner.selectBuildingCardPlay(state, 'bot1');
      assert.strictEqual(result, null);
    });
  });

  describe('Authoritative Driver Replay with Buildings', function() {
    it('applies bot House play authoritatively through game_manager and botStepToAction', function() {
      const state = createTestState();
      const houseCard = { id: 'house_1', title: 'House', type: 'action', value: 3 };
      state.players.bot1.hand = [houseCard];
      state.players.bot1.properties = {
        Green: {
          cards: [
            { id: 'g1', name: 'NC', color: 'Green', value: 3 },
            { id: 'g2', name: 'PA', color: 'Green', value: 3 },
            { id: 'g3', name: 'SC', color: 'Green', value: 3 }
          ],
          hasHouse: false
        }
      };

      const planned = turn_planner.selectActionCardPlay(state, 'bot1');
      assert(planned);
      assert.strictEqual(planned.actionCardTitle, 'House');
      assert.strictEqual(planned.propertyColor, 'Green');

      const action = app.__botDriver.botStepToAction(planned, 'bot1');
      assert.strictEqual(action.type, 'PLAY_ACTION_CARD');
      assert.strictEqual(action.propertyColor, 'Green');

      const res = game_manager.applyAction(state, action);
      assert.strictEqual(res.legal, true);
      assert.strictEqual(res.gameState.players.bot1.properties.Green.hasHouse, true);
      assert.strictEqual(res.gameState.players.bot1.hand.length, 0);
      assert.strictEqual(res.gameState.discardPile.length, 1);
      assert.strictEqual(res.gameState.discardPile[0].id, 'house_1');
    });

    it('applies bot Hotel play authoritatively after House is present', function() {
      const state = createTestState();
      const hotelCard = { id: 'hotel_1', title: 'Hotel', type: 'action', value: 4 };
      state.players.bot1.hand = [hotelCard];
      state.players.bot1.properties = {
        Green: {
          cards: [
            { id: 'g1', name: 'NC', color: 'Green', value: 3 },
            { id: 'g2', name: 'PA', color: 'Green', value: 3 },
            { id: 'g3', name: 'SC', color: 'Green', value: 3 }
          ],
          hasHouse: true,
          hasHotel: false
        }
      };

      const planned = turn_planner.selectActionCardPlay(state, 'bot1');
      assert(planned);
      assert.strictEqual(planned.actionCardTitle, 'Hotel');
      assert.strictEqual(planned.propertyColor, 'Green');

      const action = app.__botDriver.botStepToAction(planned, 'bot1');
      const res = game_manager.applyAction(state, action);
      assert.strictEqual(res.legal, true);
      assert.strictEqual(res.gameState.players.bot1.properties.Green.hasHouse, true);
      assert.strictEqual(res.gameState.players.bot1.properties.Green.hasHotel, true);
      assert.strictEqual(res.gameState.discardPile[0].id, 'hotel_1');
    });
  });
});
