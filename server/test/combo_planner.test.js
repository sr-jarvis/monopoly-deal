const assert = require("assert");
const combo_planner = require("../combo_planner");
const game_manager = require("../game_manager");

describe("Monopoly Deal v3.3 Multi-Turn Combo Planner & Evaluator", function() {

    describe("getComboTacticsCatalog", function() {
        it("should return a catalog with 6 tactic templates", function() {
            const catalog = combo_planner.getComboTacticsCatalog();
            assert(Array.isArray(catalog));
            assert.strictEqual(catalog.length, 6);
            for (const item of catalog) {
                assert(item.id);
                assert(item.title);
                assert(Array.isArray(item.requiredCardTitles));
                assert(item.synergyMultiplier >= 1.0);
            }
        });
    });

    describe("evaluateActionCombo", function() {
        it("should evaluate RENT_DOUBLE combo when required cards are present", function() {
            const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
            gameState.players["p1"].hand = [
                { id: "c1", title: "Rent (Wild)", type: "rent" },
                { id: "c2", title: "Double The Rent", type: "action" }
            ];
            gameState.players["p1"].properties = {
                "Boardwalk": [{ name: "Boardwalk", color: "DarkBlue" }]
            };

            const result = combo_planner.evaluateActionCombo(gameState, "p1", "RENT_DOUBLE");
            assert.strictEqual(result.eligible, true);
            assert.strictEqual(result.templateId, "RENT_DOUBLE");
            assert.strictEqual(result.steps.length, 2);
            assert(result.comboScore > 0);
        });

        it("should report non-eligible if required cards are missing from hand", function() {
            const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
            gameState.players["p1"].hand = [
                { id: "c1", title: "Pass Go", type: "action" }
            ];

            const result = combo_planner.evaluateActionCombo(gameState, "p1", "RENT_DOUBLE");
            assert.strictEqual(result.eligible, false);
            assert(result.reason.includes("Missing required cards"));
        });

        it("should throw error on unknown template ID", function() {
            const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
            assert.throws(() => {
                combo_planner.evaluateActionCombo(gameState, "p1", "INVALID_TEMPLATE");
            }, /Unknown combo template/);
        });
    });

    describe("planMultiTurnCombo", function() {
        it("should select the highest synergy combo option when multiple are available", function() {
            const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
            gameState.currentTurn = "p1";
            gameState.players["p1"].hand = [
                { id: "c1", title: "Rent", type: "rent" },
                { id: "c2", title: "Double The Rent", type: "action" },
                { id: "c3", title: "Pass Go", type: "action" }
            ];

            const planResult = combo_planner.planMultiTurnCombo(gameState, "p1");
            assert(planResult.recommendedCombo);
            assert(planResult.recommendedCombo.comboScore > 0);
            assert(planResult.evaluatedCount >= 1);
        });

        it("should return fallback single move if no combos are eligible", function() {
            const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
            gameState.currentTurn = "p1";
            gameState.players["p1"].hand = [
                { id: "c1", title: "1M", type: "money" }
            ];

            const planResult = combo_planner.planMultiTurnCombo(gameState, "p1");
            assert(planResult.recommendedCombo);
            assert.strictEqual(planResult.recommendedCombo.templateId, "SINGLE_MOVE_FALLBACK");
        });
    });
});
