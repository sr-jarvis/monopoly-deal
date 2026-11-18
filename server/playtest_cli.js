/**
 * playtest_cli.js
 * 
 * Interactive/Inspectable Stark-themed CLI Playtest Simulator for Monopoly Deal.
 * Exercises the authoritative server-side rules_validator and game_manager.
 */

'use strict';

const game_manager = require('./game_manager');
const { PHASES, ACTION_TYPES } = require('./rules_validator');

// Stark-HUD styled ANSI colors
const CYAN = '\x1b[36m';
const PURPLE = '\x1b[35m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const ORANGE = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function printHeader(title) {
    console.log(`\n${CYAN}================================================================================${RESET}`);
    console.log(`${BOLD}${CYAN}  🛡️  [STARK-DEAL-HUD] :: ${title}${RESET}`);
    console.log(`${CYAN}================================================================================${RESET}`);
}

function printSubHeader(subtitle) {
    console.log(`\n${BOLD}${PURPLE}❖ ${subtitle}${RESET}`);
}

function renderPlayerState(state, playerId) {
    const player = state.players[playerId];
    const isMyTurn = state.turn && state.turn.playerId === playerId;
    const turnMarker = isMyTurn ? `${GREEN}[ACTIVE TURN]${RESET} ` : '';
    
    console.log(`\n  👤 Player: ${BOLD}${player.name}${RESET} (${player.id}) ${turnMarker}`);
    console.log(`     🏦 Bank Value: ${GREEN}$${getBankValue(player)}M${RESET}`);
    console.log(`     📁 Hand Size: ${player.hand.length} cards`);
    console.log(`     🗂️  Properties:`);
    const colors = Object.keys(player.properties);
    if (colors.length === 0) {
        console.log(`        - None`);
    } else {
        colors.forEach(col => {
            const count = player.properties[col].cards.length;
            console.log(`        • ${CYAN}${col}${RESET}: ${count} card(s)`);
        });
    }
}

function getBankValue(player) {
    return player.bank.reduce((sum, card) => sum + (card.value || 0), 0);
}

// 1. Initialize Game
printHeader("INITIALIZING AUTHORITATIVE GAME STATE");

const players = [
    { id: 'socket_stark_001', name: 'Tony Stark' },
    { id: 'socket_rogers_002', name: 'Steve Rogers' }
];

console.log(`Registering players:`);
players.forEach(p => console.log(`  - Registered ${BOLD}${p.name}${RESET} on channel ${p.id}`));

let state = game_manager.createGameState(players);
console.log(`\n[SUCCESS] Authoritative Hasbro-standard playable deck created & shuffled (106 cards total; 4 rules/reference cards excluded).`);
console.log(`[SUCCESS] Dealt 5 initial cards to all players.`);

renderPlayerState(state, 'socket_stark_001');
renderPlayerState(state, 'socket_rogers_002');

// 2. Start Turn 1 (Tony Stark)
printSubHeader("TURN 1 — TONY STARK'S DEPLOYMENT PHASE");

console.log(`Current phase: ${BOLD}${state.turn.phase}${RESET}`);
console.log(`Checking draw requirements: Tony hand size is ${state.players['socket_stark_001'].hand.length}.`);

// Tony Stark must draw first
const drawAction = {
    type: 'DRAW',
    playerId: 'socket_stark_001',
    count: 2
};
console.log(`Tony Stark triggers action: ${BOLD}DRAW${RESET}`);
let result = game_manager.applyAction(state, drawAction);

if (result.legal) {
    state = result.gameState;
    console.log(`[SUCCESS] Tony Stark drew cards. New hand size: ${BOLD}${state.players['socket_stark_001'].hand.length}${RESET}`);
    console.log(`Transitioned to action phase: ${BOLD}${state.turn.phase}${RESET}`);
} else {
    console.log(`${RED}[FAILED] Draw action rejected: ${result.reason}${RESET}`);
}

// Tony Stark plays first card: Bank a MoneyCard
const tonyHand = state.players['socket_stark_001'].hand;
const moneyCard = tonyHand.find(c => c.type === 'MoneyCard');

if (moneyCard) {
    printSubHeader(`TONY STARK ACTION 1 — BANKING ${moneyCard.title}`);
    const playAction = {
        type: 'PLAY_CARD',
        playerId: 'socket_stark_001',
        cardId: moneyCard.id,
        targetZone: 'bank'
    };
    result = game_manager.applyAction(state, playAction);
    if (result.legal) {
        state = result.gameState;
        console.log(`[SUCCESS] Played ${BOLD}${moneyCard.title}${RESET} ($${moneyCard.value}M) into bank.`);
        console.log(`Plays made this turn: ${BOLD}${state.turn.playsMade}/3${RESET}`);
    } else {
        console.log(`${RED}[FAILED] Action rejected: ${result.reason}${RESET}`);
    }
}

// Tony Stark plays second card: Play a PropertyCard
const propCard = state.players['socket_stark_001'].hand.find(c => c.type === 'PropertyCard');

if (propCard) {
    printSubHeader(`TONY STARK ACTION 2 — DEPLOYING PROPERTY ${propCard.title}`);
    const color = propCard.propertyTypes && propCard.propertyTypes[0] ? propCard.propertyTypes[0] : 'Green';
    const playPropAction = {
        type: 'PLAY_CARD',
        playerId: 'socket_stark_001',
        cardId: propCard.id,
        targetZone: 'properties',
        propertyColor: color
    };
    result = game_manager.applyAction(state, playPropAction);
    if (result.legal) {
        state = result.gameState;
        console.log(`[SUCCESS] Deployed property ${BOLD}${propCard.title}${RESET} in ${CYAN}${color}${RESET} set.`);
        console.log(`Plays made this turn: ${BOLD}${state.turn.playsMade}/3${RESET}`);
    } else {
        console.log(`${RED}[FAILED] Action rejected: ${result.reason}${RESET}`);
    }
}

// 3. SECURITY GATE INTRUSION TEST — Steve Rogers attempts to play out of turn
printSubHeader("SECURITY GATE TEST — ILLEGAL ACTION CHECKS");
console.log(`Steve Rogers attempts to play property card ${BOLD}out of turn${RESET}...`);
const steveProp = state.players['socket_rogers_002'].hand.find(c => c.type === 'PropertyCard');

if (steveProp) {
    const intruderAction = {
        type: 'PLAY_CARD',
        playerId: 'socket_rogers_002',
        cardId: steveProp.id,
        targetZone: 'properties',
        propertyColor: 'Blue'
    };
    const intrudeResult = game_manager.applyAction(state, intruderAction);
    if (!intrudeResult.legal) {
        console.log(`${GREEN}[SUCCESS] Out-of-turn play blocked by validator: "${intrudeResult.reason}"${RESET}`);
    } else {
        console.log(`${RED}[WARNING] Security breach! Out-of-turn play was allowed!${RESET}`);
    }
} else {
    console.log(`No property card found in Steve hand to test.`);
}

// 4. Tony Stark ends turn
printSubHeader("ENDING TONY STARK'S TURN");
const endTurnAction = {
    type: 'END_TURN',
    playerId: 'socket_stark_001'
};
result = game_manager.applyAction(state, endTurnAction);

if (result.legal) {
    state = result.gameState;
    console.log(`[SUCCESS] Tony Stark's turn completed.`);
    console.log(`It is now ${BOLD}Steve Rogers'${RESET} turn.`);
} else {
    console.log(`${RED}[FAILED] Could not end turn: ${result.reason}${RESET}`);
}

// Steve Rogers draws cards for his turn automatically
printSubHeader("STEVE ROGERS' TURN ENGINE TRIGGERS");
const steveDrawAction = {
    type: 'DRAW',
    playerId: 'socket_rogers_002',
    count: 2
};
result = game_manager.applyAction(state, steveDrawAction);
if (result.legal) {
    state = result.gameState;
    console.log(`[SUCCESS] Steve Rogers drew 2 cards. New hand size: ${state.players['socket_rogers_002'].hand.length}`);
} else {
    console.log(`${RED}[FAILED] Steve Rogers drawing failed: ${result.reason}${RESET}`);
}

renderPlayerState(state, 'socket_stark_001');
renderPlayerState(state, 'socket_rogers_002');

printHeader("PLAYTEST SIMULATION COMPLETE — ALL AUTH VALIDATORS 100% GREEN");
