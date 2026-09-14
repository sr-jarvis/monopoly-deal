'use strict';
const { HAND_LIMIT, MAX_PLAYS_PER_TURN, NORMAL_DRAW_COUNT, EMPTY_HAND_DRAW_COUNT, PHASES } = require('./rules_validator');
const { COMPLETE_SET_SIZE } = require('./card_catalog');

function getRulesReference() {
    return {
        version: 'RULES_SPEC.md v1.2',
        turnPhases: {
            DRAW: {
                allowedActions: ['DRAW'],
                drawCounts: {
                    emptyHand: EMPTY_HAND_DRAW_COUNT,
                    normal: NORMAL_DRAW_COUNT
                }
            },
            ACTION: {
                allowedActions: ['PLAY_CARD', 'REARRANGE', 'END_TURN', 'JUST_SAY_NO'],
                maxPlaysPerTurn: MAX_PLAYS_PER_TURN,
                freeActions: ['REARRANGE', 'JUST_SAY_NO']
            },
            DISCARD: {
                allowedActions: ['DISCARD', 'REARRANGE'],
                entryCondition: `hand size > ${HAND_LIMIT}`
            },
            COMPLETE: {
                allowedActions: []
            }
        },
        handLimit: HAND_LIMIT,
        actionLimits: {
            maxPlaysPerTurn: MAX_PLAYS_PER_TURN,
            freeActions: ['REARRANGE', 'JUST_SAY_NO']
        },
        bankRules: {
            acceptedCardTypes: ['Money', 'Action'],
            reversible: false
        },
        houseHotelRules: {
            house: {
                rentBonus: 3,
                excludedTypes: ['Railroad', 'Utility']
            },
            hotel: {
                rentBonus: 4,
                excludedTypes: ['Railroad', 'Utility']
            }
        },
        winCondition: {
            completeSetsRequired: 3,
            completeSetSize: COMPLETE_SET_SIZE
        }
    };
}

module.exports = {
    getRulesReference
};
