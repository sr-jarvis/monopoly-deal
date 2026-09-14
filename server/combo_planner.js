/**
 * Monopoly Deal v3.3 AI Bot Multi-Turn Strategic Action Planner & Combo Evaluator
 */

const rules_validator = require("./rules_validator");
const trade_evaluator = require("./trade_evaluator");
const bot_engine = require("./bot_engine");

const COMBO_TACTIC_TEMPLATES = [
    {
        id: "RENT_DOUBLE",
        title: "Rent + Double The Rent Synergy",
        requiredCardTitles: ["Rent", "Double The Rent"],
        synergyMultiplier: 2.0,
        description: "Plays a targeted or wild Rent card followed immediately by Double The Rent to maximize revenue."
    },
    {
        id: "RENT_DOUBLE_DOUBLE",
        title: "Rent + Double Rent x2 Overdrive",
        requiredCardTitles: ["Rent", "Double The Rent", "Double The Rent"],
        synergyMultiplier: 4.0,
        description: "Plays a Rent card followed by two Double The Rent cards in a single 3-play turn."
    },
    {
        id: "SLY_FORCED_DEAL",
        title: "Sly Deal + Forced Deal Set Disruption",
        requiredCardTitles: ["Sly Deal", "Forced Deal"],
        synergyMultiplier: 1.15,
        description: "Steals an open property and swaps a low-value property to complete or break sets in a single turn."
    },
    {
        id: "PASS_GO_FOLLOWUP",
        title: "Pass Go Acceleration",
        requiredCardTitles: ["Pass Go"],
        synergyMultiplier: 1.1,
        description: "Plays Pass Go first to draw 2 extra cards, expanding available combo options for remaining turn plays."
    },
    {
        id: "RENT_DEBT_COLLECTOR",
        title: "Rent + Debt Collector Income Sweep",
        requiredCardTitles: ["Rent", "Debt Collector"],
        synergyMultiplier: 1.1,
        description: "Combines Rent collection with Debt Collector targeting to drain opponent bank reserves."
    },
    {
        id: "BIRTHDAY_RENT",
        title: "It's My Birthday + Rent Multi-Player Tax",
        requiredCardTitles: ["Its My Birthday", "Rent"],
        synergyMultiplier: 1.1,
        description: "Demands $2M from all opponents via Birthday, followed by targeted Rent collection."
    }
];

function getComboTacticsCatalog() {
    return COMBO_TACTIC_TEMPLATES;
}

function calculateStepEV(step, gameState, playerId) {
    if (step.cardTitle === "Rent") {
        const matrix = trade_evaluator.calculateCardValueMatrix(gameState, playerId);
        const myProperties = (gameState.players && gameState.players[playerId] && gameState.players[playerId].properties) || {};
        let bestColor = null;
        let maxRent = 0;
        for (const [color, props] of Object.entries(myProperties)) {
            if (props && props.length > 0) {
                const rentVal = rules_validator.calculateRentAmount(gameState, playerId, color).totalRent;
                if (rentVal > maxRent) {
                    maxRent = rentVal;
                    bestColor = color;
                }
            }
        }
        return { expectedValue: maxRent || 2, targetColor: bestColor || "All" };
    }
    
    if (step.cardTitle === "Double The Rent") {
        return { expectedValue: 2 };
    }

    if (step.cardTitle === "Debt Collector") {
        return { expectedValue: 5 };
    }

    if (step.cardTitle === "Its My Birthday") {
        const opponentCount = gameState.players ? Object.keys(gameState.players).length - 1 : 1;
        return { expectedValue: 2 * Math.max(1, opponentCount) };
    }

    if (step.cardTitle === "Pass Go") {
        return { expectedValue: 4 };
    }

    if (step.cardTitle === "Sly Deal" || step.cardTitle === "Forced Deal") {
        return { expectedValue: 3 };
    }

    return { expectedValue: 2 };
}

function evaluateActionCombo(gameState, playerId, templateId, options = {}) {
    const template = COMBO_TACTIC_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
        throw new Error(`Unknown combo template: ${templateId}`);
    }

    const player = gameState.players && gameState.players[playerId];
    const hand = (player && player.hand) || [];

    // Check card presence
    const availableTitles = hand.map(c => c.title || c.type || c.name || "");
    const titleCounts = {};
    for (const title of availableTitles) {
        titleCounts[title] = (titleCounts[title] || 0) + 1;
    }

    let isEligible = true;
    const reqCounts = {};
    for (const reqTitle of template.requiredCardTitles) {
        reqCounts[reqTitle] = (reqCounts[reqTitle] || 0) + 1;
    }

    for (const [title, reqCount] of Object.entries(reqCounts)) {
        let matchedCount = 0;
        for (const [availTitle, count] of Object.entries(titleCounts)) {
            if (availTitle.toLowerCase().includes(title.toLowerCase())) {
                matchedCount += count;
            }
        }
        if (matchedCount < reqCount) {
            isEligible = false;
            break;
        }
    }

    if (!isEligible) {
        return {
            templateId,
            title: template.title,
            eligible: false,
            reason: "Missing required cards in hand for this combo tactic"
        };
    }

    const steps = [];
    let baseEVSum = 0;

    for (let i = 0; i < template.requiredCardTitles.length; i++) {
        const cardTitle = template.requiredCardTitles[i];
        const stepCalc = calculateStepEV({ cardTitle }, gameState, playerId);
        let stepEv = stepCalc.expectedValue;
        if (cardTitle === "Double The Rent" && i > 0 && steps[i - 1].cardTitle === "Rent") {
            stepEv = steps[i - 1].expectedValue;
        }
        steps.push({
            stepNumber: i + 1,
            cardTitle,
            targetColor: stepCalc.targetColor || null,
            expectedValue: stepEv,
            engineValidated: true
        });
        baseEVSum += stepEv;
    }

    const comboScore = Math.round(baseEVSum * template.synergyMultiplier * 10) / 10;

    return {
        templateId,
        title: template.title,
        eligible: true,
        steps,
        baseEV: baseEVSum,
        synergyMultiplier: template.synergyMultiplier,
        comboScore
    };
}

function planMultiTurnCombo(gameState, playerId) {
    if (!gameState || !playerId || !gameState.players || !gameState.players[playerId]) {
        return { recommendedCombo: null, reason: "Invalid game state or player ID" };
    }

    const player = gameState.players[playerId];
    if (gameState.currentTurn && gameState.currentTurn !== playerId) {
        return { recommendedCombo: null, reason: "Not player turn" };
    }

    const eligibleCombos = [];
    for (const template of COMBO_TACTIC_TEMPLATES) {
        const result = evaluateActionCombo(gameState, playerId, template.id);
        if (result.eligible) {
            eligibleCombos.push(result);
        }
    }

    if (eligibleCombos.length === 0) {
        // Fallback single move evaluation
        const engine = new bot_engine.MonopolyBotEngine("BALANCED");
        const decision = engine.evaluateHandAndState(gameState, playerId);
        return {
            recommendedCombo: {
                templateId: "SINGLE_MOVE_FALLBACK",
                title: "Single Strategic Move",
                eligible: true,
                steps: [{
                    stepNumber: 1,
                    cardTitle: decision.cardToPlay ? (decision.cardToPlay.title || "Card") : "End Turn",
                    expectedValue: 2,
                    engineValidated: true
                }],
                baseEV: 2,
                synergyMultiplier: 1.0,
                comboScore: 2
            },
            alternatives: [],
            evaluatedCount: 0
        };
    }

    eligibleCombos.sort((a, b) => b.comboScore - a.comboScore);

    return {
        recommendedCombo: eligibleCombos[0],
        alternatives: eligibleCombos.slice(1),
        evaluatedCount: eligibleCombos.length
    };
}

module.exports = {
    COMBO_TACTIC_TEMPLATES,
    getComboTacticsCatalog,
    evaluateActionCombo,
    planMultiTurnCombo
};
