const express = require("express");
const app = express();
var http = require("http").Server(app);
var io = require("socket.io")(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
app.use(express.json());

const game_manager = require("./game_manager");
const room_view = require("./room_view");
const room_registry = require("./room_registry");
const card_catalog = require("./card_catalog");
const rules_catalog = require("./rules_catalog");
const rules_validator = require("./rules_validator");
const { MonopolyBotEngine, STRATEGY_PROFILES, RISK_PROFILES, getDifficultyProfiles } = require("./bot_engine");
const botEngine = new MonopolyBotEngine();
const match_simulator = require("./match_simulator");
const tournament_engine = require("./tournament_engine");
const blunder_analyzer = require("./blunder_analyzer");
const trade_evaluator = require("./trade_evaluator");
const trade_negotiator = require("./trade_negotiator");
const combo_planner = require("./combo_planner");
const hand_inference = require("./hand_inference");
const finisher_planner = require("./finisher_planner");
const discard_optimizer = require("./discard_optimizer");
const payment_optimizer = require("./payment_optimizer");
const rent_mitigation_optimizer = require("./rent_mitigation_optimizer");
const dealbreaker_defense = require("./dealbreaker_defense");
const opponent_profiler = require("./opponent_profiler");
const turn_planner = require("./turn_planner");
const match_replay_analyzer = require("./match_replay_analyzer");
const replay_benchmark_evaluator = require("./replay_benchmark_evaluator");
const replay_strategy_tuner = require("./replay_strategy_tuner");
const tournament_runner = require("./tournament_runner");
const tournament_meta_adaptor = require("./tournament_meta_adaptor");
const league_elo_calculator = require("./league_elo_calculator");
const league_season_manager = require("./league_season_manager");

app.get("/", function(req, res) {
    res.send("<h1>Welcome to the Monopoly Deal server page (Server-Authoritative v1.5).</h1>");
});

app.get("/api/monopoly/rooms", function(req, res) {
    const activeRooms = room_registry.listRooms();
    res.json({
        status: "ok",
        count: activeRooms.length,
        rooms: activeRooms
    });
});

app.get("/api/monopoly/stats", function(req, res) {
    res.json({ status: "ok", stats: room_registry.getStats() });
});

app.get("/api/monopoly/cards", function(req, res) {
    res.json({ status: "ok", catalog: card_catalog.getCardCatalog() });
});

app.get("/api/monopoly/rules", function(req, res) {
    res.json({ status: "ok", rules: rules_catalog.getRulesReference() });
});

app.post("/api/monopoly/validate-action", function(req, res) {
    try {
        const { roomId, playerId, action } = req.body || {};
        if (!roomId || !playerId || !action || !action.type) {
            return res.status(400).json({
                status: "error",
                valid: false,
                errors: ["roomId, playerId, and action.type are required"],
                warnings: [],
                actionSummary: null
            });
        }
        const room = room_registry.getRoom((roomId || '').toUpperCase());
        if (!room) {
            return res.status(404).json({ status: "error", message: "Room not found" });
        }
        if (!room.gameState) {
            return res.status(409).json({ status: "error", message: "Room has no active game" });
        }

        const result = rules_validator.validatePlayerAction(room.gameState, playerId, action);
        return res.json({
            status: "ok",
            valid: result.valid,
            errors: result.errors,
            warnings: result.warnings,
            actionSummary: result.actionSummary
        });
    } catch (err) {
        console.error('[validate-action] unexpected error:', err);
        return res.status(500).json({ status: "error", message: "Internal error validating action" });
    }
});

app.post("/api/monopoly/calculate-rent", function(req, res) {
    try {
        const { roomId, ownerId, propertyColor, payerId, settlement } = req.body || {};
        if (!roomId || !ownerId || !propertyColor) {
            return res.status(400).json({ status: "error", message: "roomId, ownerId, and propertyColor are required" });
        }
        const room = room_registry.getRoom((roomId || '').toUpperCase());
        if (!room) {
            return res.status(404).json({ status: "error", message: "Room not found" });
        }
        if (!room.gameState) {
            return res.status(409).json({ status: "error", message: "Room has no active game" });
        }

        const rent = rules_validator.calculateRentAmount(room.gameState, ownerId, propertyColor);
        if (rent.errors && rent.errors.length) {
            return res.status(400).json({ status: "error", errors: rent.errors });
        }

        let settlementResult = null;
        if (settlement) {
            if (!payerId) {
                return res.status(400).json({ status: "error", message: "payerId is required to validate a settlement" });
            }
            const action = Object.assign({ type: 'PAY_RENT', toPlayerId: ownerId, propertyColor }, settlement);
            const result = rules_validator.validateRentPaymentAction(room.gameState, Object.assign({}, action, { playerId: payerId }));
            settlementResult = {
                valid: result.errors.length === 0,
                errors: result.errors,
                rentAmount: result.rentAmount,
                settlementValue: result.settlementValue,
                shortfall: result.shortfall
            };
        }

        return res.json({ status: "ok", rent, settlement: settlementResult });
    } catch (err) {
        console.error('[calculate-rent] unexpected error:', err);
        return res.status(500).json({ status: "error", message: "Internal error calculating rent" });
    }
});

app.post("/api/monopoly/play-action-card", function(req, res) {
    try {
        const { roomId, playerId, action } = req.body || {};
        if (!roomId || !playerId || !action || !action.cardTitle) {
            return res.status(400).json({
                status: "error",
                valid: false,
                errors: ["roomId, playerId, and action.cardTitle are required"],
                actionSummary: null
            });
        }
        const room = room_registry.getRoom((roomId || '').toUpperCase());
        if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
        if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });

        const result = rules_validator.validateActionCardPlay(room.gameState, Object.assign({}, action, { playerId }));
        return res.json({ status: "ok", valid: result.legal, errors: result.errors, actionSummary: result.actionSummary });
    } catch (err) {
        console.error('[play-action-card] unexpected error:', err);
        return res.status(500).json({ status: "error", message: "Internal error validating action card play" });
    }
});

app.post("/api/monopoly/check-win-condition", function(req, res) {
    try {
        const { roomId, playerId, playerState } = req.body || {};
        if (playerState) {
            const winCheck = rules_validator.checkWinCondition(playerState);
            return res.json({
                status: "ok",
                isWinner: winCheck.isWinner,
                completedSetColors: winCheck.completedSetColors,
                details: winCheck.details
            });
        }

        if (!roomId || !playerId) {
            return res.status(400).json({
                status: "error",
                message: "Provide either playerState object OR both roomId and playerId"
            });
        }

        const room = room_registry.getRoom((roomId || '').toUpperCase());
        if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
        if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });

        const evalResult = game_manager.evaluateWinCondition(room.gameState, playerId);
        if (!evalResult.legal) {
            return res.status(400).json({ status: "error", message: evalResult.reason });
        }

        if (evalResult.transitioned) {
            room.gameState = evalResult.gameState;
            room.status = 'FINISHED';
        }

        return res.json({
            status: "ok",
            isWinner: evalResult.winResult.isWinner,
            winnerId: evalResult.gameState.winnerId,
            completedSetColors: evalResult.winResult.completedSetColors,
            details: evalResult.winResult.details,
            gameStatus: evalResult.gameState.status
        });
    } catch (err) {
        console.error('[check-win-condition] unexpected error:', err);
        return res.status(500).json({ status: "error", message: "Internal error checking win condition" });
    }
});

app.get("/api/monopoly/rooms/:id", function(req, res) {
    const roomCode = (req.params.id || '').toUpperCase();
    const room = room_registry.getRoom(roomCode);
    if (!room) {
        return res.status(404).json({ status: "error", message: "Room not found" });
    }
    return res.json({ status: "ok", room: room_registry.toRoomDetail(room) });
});

app.get("/api/monopoly/rooms/:id/replay", function(req, res) {
    const roomCode = (req.params.id || '').toUpperCase();
    const room = room_registry.getRoom(roomCode);
    if (!room) {
        return res.status(404).json({ status: "error", message: "Room not found" });
    }
    if (!room.gameState) {
        return res.status(409).json({ status: "error", message: "Room has no active game" });
    }

    const since = Number.parseInt(req.query.since, 10);
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    let events = room.gameState.replayLogs || [];
    if (Number.isFinite(since)) {
        events = events.filter(e => e.seq > since);
    }
    const truncated = events.length > limit;
    events = events.slice(0, limit);

    return res.json({ status: "ok", roomCode, count: events.length, truncated, events });
});

app.get("/api/monopoly/rooms/:id/telemetry", function(req, res) {
    const roomCode = (req.params.id || '').toUpperCase();
    const room = room_registry.getRoom(roomCode);
    if (!room) {
        return res.status(404).json({ status: "error", message: "Room not found" });
    }
    if (!room.gameState) {
        return res.status(409).json({ status: "error", message: "Room has no active game" });
    }

    const telemetry = game_manager.getMatchTelemetry(room.gameState);
    return res.json({ status: "ok", roomCode, telemetry });
});

app.post("/api/monopoly/rooms/:id/reset", function(req, res) {
    const roomCode = (req.params.id || '').toUpperCase();
    const result = room_registry.resetRoom(roomCode);
    if (result.error) {
        return res.status(404).json({ status: "error", message: result.error });
    }
    io.to(`room:${roomCode}`).emit('room:state', room_registry.toRoomState(result.room));
    io.to(`room:${roomCode}`).emit('game:event', { type: 'ADMIN_RESET', message: 'Room was reset by admin.' });
    return res.json({ status: "ok", room: room_registry.toRoomState(result.room) });
});

app.delete("/api/monopoly/rooms/:id", function(req, res) {
    const roomCode = (req.params.id || '').toUpperCase();
    const result = room_registry.deleteRoom(roomCode);
    if (result.error) {
        return res.status(404).json({ status: "error", message: result.error });
    }
    io.to(`room:${roomCode}`).emit('room:closed', { reason: 'Room deleted by administrator' });
    io.socketsLeave(`room:${roomCode}`);
    return res.json({ status: "ok", message: `Room ${roomCode} deleted` });
});

app.post("/api/monopoly/bot/decide-move", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, playerSeat } = req.body || {};
        if (!playerSeat || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "playerSeat and either roomId or gameState are required" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[playerSeat]) {
            return res.status(400).json({ status: "error", message: "playerSeat not found in gameState.players" });
        }

        const decision = botEngine.evaluateHandAndState(gameState, playerSeat);
        return res.json({ status: "ok", decision });
    } catch (err) {
        console.error('[bot/decide-move] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error computing bot decision" });
    }
});

app.post("/api/monopoly/bot/simulate-match", function(req, res) {
    try {
        const { botCount, playerNames, maxTurns, includeReplayLog } = req.body || {};
        if (botCount !== undefined && (isNaN(parseInt(botCount)) || parseInt(botCount) < 2 || parseInt(botCount) > 5)) {
            return res.status(400).json({ status: "error", message: "botCount must be an integer between 2 and 5" });
        }
        const simulation = match_simulator.simulateMatch({ botCount, playerNames, maxTurns, includeReplayLog });
        return res.json({ status: "ok", simulation });
    } catch (err) {
        console.error('[bot/simulate-match] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error executing match simulation" });
    }
});

app.get("/api/monopoly/bot/simulations/stats", function(req, res) {
    try {
        const stats = match_simulator.getSimulationStats();
        return res.json({ status: "ok", stats });
    } catch (err) {
        console.error('[bot/simulations/stats] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving simulation stats" });
    }
});

app.get("/api/monopoly/bot/personas", function(req, res) {
    try {
        return res.json({ status: "ok", count: Object.keys(STRATEGY_PROFILES).length, personas: STRATEGY_PROFILES });
    } catch (err) {
        console.error('[bot/personas] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving strategy personas" });
    }
});

app.post("/api/monopoly/bot/tournament", function(req, res) {
    try {
        const { participants, roundsPerMatchup, maxTurns } = req.body || {};
        if (participants !== undefined && (!Array.isArray(participants) || participants.length < 2 || participants.length > 5)) {
            return res.status(400).json({ status: "error", message: "participants must be an array of 2 to 5 strategy names" });
        }
        const tournament = tournament_engine.runTournament({ participants, roundsPerMatchup, maxTurns });
        return res.json({ status: "ok", tournament });
    } catch (err) {
        if (err.message && err.message.startsWith('Unknown strategy participant')) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/tournament] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error executing tournament simulation" });
    }
});

app.get("/api/monopoly/bot/tournament-modes", function(req, res) {
    try {
        const modes = tournament_runner.getTournamentModesCatalog();
        return res.json({ status: "ok", count: modes.length, modes });
    } catch (err) {
        console.error('[bot/tournament-modes] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving tournament modes" });
    }
});

app.post("/api/monopoly/bot/run-tournament-series", function(req, res) {
    try {
        const { strategies, mode, matchesPerPairing, maxTurns, includeReplayLog } = req.body || {};
        const series = tournament_runner.simulateTournamentSeries({ strategies, mode, matchesPerPairing, maxTurns, includeReplayLog });
        const standings = tournament_runner.evaluateTournamentStandings(series);
        return res.json({ status: "ok", series, standings });
    } catch (err) {
        if (err.message && (
            err.message.includes("Unknown strategy participant") ||
            err.message.includes("Unknown tournament mode") ||
            err.message.includes("must contain between") ||
            err.message.includes("duplicate entries")
        )) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/run-tournament-series] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error running tournament series" });
    }
});

app.get("/api/monopoly/bot/risk-profiles", function(req, res) {
    try {
        return res.json({ status: "ok", count: Object.keys(RISK_PROFILES).length, profiles: RISK_PROFILES });
    } catch (err) {
        console.error('[bot/risk-profiles] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving risk profiles" });
    }
});

app.post("/api/monopoly/bot/analyze-replay", function(req, res) {
    try {
        const { replayLog, botPlayerId } = req.body || {};
        if (!Array.isArray(replayLog) || replayLog.length === 0 || !botPlayerId) {
            return res.status(400).json({ status: "error", message: "replayLog (non-empty array) and botPlayerId string are required" });
        }
        if (replayLog.length > blunder_analyzer.MAX_REPLAY_LOG_ENTRIES) {
            return res.status(400).json({ status: "error", message: `replayLog exceeds max allowed entries (${blunder_analyzer.MAX_REPLAY_LOG_ENTRIES})` });
        }
        const analysis = blunder_analyzer.analyzeBotReplay(replayLog, botPlayerId);
        return res.json({ status: "ok", analysis });
    } catch (err) {
        if (err.message && (err.message.includes("must be a non-empty array") || err.message.includes("string is required"))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/analyze-replay] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error analyzing bot replay" });
    }
});

app.get("/api/monopoly/bot/blunder-rules", function(req, res) {
    try {
        const rules = blunder_analyzer.getBlunderDetectionRules();
        return res.json({ status: "ok", count: rules.length, rules });
    } catch (err) {
        console.error('[bot/blunder-rules] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving blunder rules" });
    }
});

app.post("/api/monopoly/bot/decide-move-custom", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, playerSeat, riskProfile, riskParams } = req.body || {};
        if (!playerSeat || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "playerSeat and either roomId or gameState are required" });
        }
        if (riskParams !== undefined && (typeof riskParams !== 'object' || riskParams === null || Array.isArray(riskParams))) {
            return res.status(400).json({ status: "error", message: "riskParams must be an object of numeric overrides" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[playerSeat]) {
            return res.status(400).json({ status: "error", message: "playerSeat not found in gameState.players" });
        }

        const { decision, riskContext } = botEngine.decideMoveCustom(gameState, playerSeat, { riskProfile, riskParams });
        return res.json({ status: "ok", decision, riskContext });
    } catch (err) {
        if (err.message && err.message.startsWith('Unknown risk profile')) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/decide-move-custom] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error computing custom bot decision" });
    }
});

app.get("/api/monopoly/bot/difficulty-levels", function(req, res) {
    try {
        const levels = getDifficultyProfiles();
        return res.json({ status: "ok", count: Object.keys(levels).length, levels });
    } catch (err) {
        console.error('[bot/difficulty-levels] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving difficulty levels" });
    }
});

app.post("/api/monopoly/bot/decide-move-handicapped", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, playerSeat, difficultyLevel, handicapParams } = req.body || {};
        if (!playerSeat || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "playerSeat and either roomId or gameState are required" });
        }
        if (handicapParams !== undefined && (typeof handicapParams !== 'object' || handicapParams === null || Array.isArray(handicapParams))) {
            return res.status(400).json({ status: "error", message: "handicapParams must be an object of numeric overrides" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[playerSeat]) {
            return res.status(400).json({ status: "error", message: "playerSeat not found in gameState.players" });
        }

        const { decision, difficultyContext } = botEngine.decideMoveHandicapped(gameState, playerSeat, { difficultyLevel, handicapParams });
        return res.json({ status: "ok", decision, difficultyContext });
    } catch (err) {
        if (err.message && err.message.startsWith('Unknown difficulty level')) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/decide-move-handicapped] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error computing handicapped bot decision" });
    }
});

app.post("/api/monopoly/bot/evaluate-trade", function(req, res) {
    try {
        const {
            roomId,
            gameState: rawGameState,
            proposingPlayerId,
            respondingPlayerId,
            offeredCardIds,
            requestedCardIds,
            riskProfile,
        } = req.body || {};

        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }

        const evaluation = trade_evaluator.evaluateTradeOffer(gameState, {
            proposingPlayerId,
            respondingPlayerId,
            offeredCardIds,
            requestedCardIds,
            riskProfile,
        });

        return res.json({ status: "ok", evaluation });
    } catch (err) {
        if (err.message && (
            err.message.includes('Must provide') ||
            err.message.includes('must be') ||
            err.message.includes('Invalid gameState') ||
            err.message.includes('not found') ||
            err.message.startsWith('Unknown risk profile')
        )) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/evaluate-trade] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error evaluating trade offer" });
    }
});

app.get("/api/monopoly/bot/card-value-matrix", function(req, res) {
    try {
        const { roomId, playerSeat } = req.query || {};
        let gameState = null;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
            if (playerSeat && (!gameState.players || !gameState.players[playerSeat])) {
                return res.status(400).json({ status: "error", message: "playerSeat not found in gameState.players" });
            }
        }

        const matrix = trade_evaluator.calculateCardValueMatrix(gameState, playerSeat || null);
        return res.json({ status: "ok", matrix });
    } catch (err) {
        console.error('[bot/card-value-matrix] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error generating card value matrix" });
    }
});

app.post("/api/monopoly/bot/negotiate-trade", function(req, res) {
    try {
        const {
            roomId, gameState: rawGameState,
            proposingPlayerId, respondingPlayerId,
            offeredCardIds, requestedCardIds,
            riskProfile, negotiationRound, thirdPartyPlayerIds
        } = req.body || {};

        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }

        const evaluation = trade_negotiator.evaluateTradeProposal(gameState, {
            proposingPlayerId, respondingPlayerId, offeredCardIds, requestedCardIds,
            riskProfile, negotiationRound, thirdPartyPlayerIds
        });

        let counterOffer = null;
        if (evaluation.recommendation === "COUNTER" && !evaluation.roundLimitReached && !evaluation.walkAwayRecommended) {
            counterOffer = trade_negotiator.generateCounterOffer(gameState, {
                proposingPlayerId, respondingPlayerId, offeredCardIds, requestedCardIds,
                riskProfile, negotiationRound: negotiationRound || 0
            });
        }

        return res.json({ status: "ok", evaluation, counterOffer });
    } catch (err) {
        if (err.message && (
            err.message.includes('Must provide') ||
            err.message.includes('must be') ||
            err.message.includes('Invalid gameState') ||
            err.message.includes('not found') ||
            err.message.startsWith('Unknown risk profile')
        )) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/negotiate-trade] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error negotiating trade" });
    }
});

app.get("/api/monopoly/bot/negotiation-rules", function(req, res) {
    try {
        const rules = trade_negotiator.getNegotiationRulesCatalog();
        return res.json({ status: "ok", count: rules.length, rules });
    } catch (err) {
        console.error('[bot/negotiation-rules] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving negotiation rules" });
    }
});

app.get("/api/monopoly/bot/combo-tactics", function(req, res) {
    try {
        const tactics = combo_planner.getComboTacticsCatalog();
        return res.json({ status: "ok", count: tactics.length, tactics });
    } catch (err) {
        console.error('[bot/combo-tactics] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving combo tactics" });
    }
});

app.post("/api/monopoly/bot/plan-combo", function(req, res) {
    try {
        let { gameState, roomId, playerId } = req.body || {};
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }

        if (!gameState || !playerId) {
            return res.status(400).json({ status: "error", message: "gameState (or valid roomId) and playerId are required" });
        }

        const result = combo_planner.planMultiTurnCombo(gameState, playerId);
        return res.json({ status: "ok", plan: result });
    } catch (err) {
        console.error('[bot/plan-combo] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error planning multi-turn combo" });
    }
});

app.get("/api/monopoly/bot/counter-tactics", function(req, res) {
    try {
        const tactics = hand_inference.getCounterTacticsCatalog();
        return res.json({ status: "ok", count: tactics.length, tactics });
    } catch (err) {
        console.error('[bot/counter-tactics] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving counter tactics" });
    }
});

app.post("/api/monopoly/bot/infer-hand", function(req, res) {
    try {
        let { gameState, roomId, opponentPlayerId, observerPlayerId } = req.body || {};
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }

        if (!gameState || !opponentPlayerId) {
            return res.status(400).json({ status: "error", message: "Missing required fields: gameState (or valid roomId) and opponentPlayerId" });
        }

        if (!gameState.players || !gameState.players[opponentPlayerId]) {
            return res.status(400).json({ status: "error", message: `Opponent player '${opponentPlayerId}' not found in gameState.players` });
        }

        const inference = hand_inference.inferOpponentHand(gameState, opponentPlayerId, observerPlayerId || null);
        return res.json({ status: "ok", inference });
    } catch (err) {
        console.error('[bot/infer-hand] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error performing hand inference" });
    }
});

app.get("/api/monopoly/bot/finisher-tactics", function(req, res) {
    try {
        const tactics = finisher_planner.getFinisherTacticsCatalog();
        return res.json({ status: "ok", count: tactics.length, tactics });
    } catch (err) {
        console.error('[bot/finisher-tactics] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving finisher tactics catalog" });
    }
});

app.post("/api/monopoly/bot/plan-finisher", function(req, res) {
    try {
        let { gameState, roomId, playerId } = req.body || {};
        if (!playerId || (!roomId && !gameState)) {
            return res.status(400).json({ status: "error", message: "playerId and either roomId or gameState are required" });
        }
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }

        if (!gameState.players || !gameState.players[playerId]) {
            return res.status(400).json({ status: "error", message: `playerId '${playerId}' not found in gameState.players` });
        }

        const plan = finisher_planner.planFinisherSequence(gameState, playerId);
        return res.json({ status: "ok", plan });
    } catch (err) {
        console.error('[bot/plan-finisher] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error planning finisher sequence" });
    }
});

const MAX_BOT_TURN_ITERATIONS = 25;

function playerDisplayName(room, gameState, playerId) {
    const seat = room.seats.find(s => s.playerId === playerId);
    if (seat) return seat.displayName;
    return (gameState.players[playerId] || {}).name || 'Player';
}

// Builds a human-readable game:event summary. Falls back to a generic
// "performed <TYPE>" line, but gives Debt Collector / Its My Birthday charge
// creation and settlement a clearer description than the action type alone.
function emitGameOverIfFinished(room, roomCode) {
    if (!room || !room.gameState || room.gameState.status !== 'FINISHED' || !room.gameState.winnerId) {
        return false;
    }

    room.status = 'FINISHED';
    const winner = room.gameState.players && room.gameState.players[room.gameState.winnerId];
    const win = rules_validator.checkWinCondition(winner);
    io.to(`room:${roomCode}`).emit('game:over', {
        winnerId: room.gameState.winnerId,
        sets: win.completedSetColors.length
    });
    io.to(`room:${roomCode}`).emit('room:state', room_registry.toRoomState(room));
    return true;
}

function buildActionEventSummary(room, action, previousGameState) {
  const gs = room.gameState;
    const actorName = playerDisplayName(room, gs, action.playerId);

    const priorPlayedCard = previousGameState.players[action.playerId]
        && previousGameState.players[action.playerId].hand.find(c => c.id === action.cardId);

    // House is added onto one of the actor's complete sets; it never creates a
    // pending charge. Describe it explicitly so a House played after a Rent in
    // the same turn isn't mistaken for the (already-settled) rent charge below.
    if (action.type === 'PLAY_ACTION_CARD' && priorPlayedCard && priorPlayedCard.title === 'House'
        && action.propertyColor) {
        return `${actorName} added a House to their complete ${action.propertyColor} set (+$3M rent).`;
    }

    // Hotel, like House, is added onto one of the actor's complete sets and never
    // creates a pending charge. Describe it explicitly so a Hotel played after a
    // Rent in the same turn isn't mistaken for the (already-settled) rent charge.
    if (action.type === 'PLAY_ACTION_CARD' && priorPlayedCard && priorPlayedCard.title === 'Hotel'
        && action.propertyColor) {
        return `${actorName} added a Hotel to their complete ${action.propertyColor} set (+$4M rent).`;
    }

    // Only treat this as "actor just played a charge card" when the card played
    // in THIS action is the charge's source — otherwise a later same-turn play
    // (e.g. House) could echo a stale/among-others pending charge.
    if (action.type === 'PLAY_ACTION_CARD' && gs.pendingCharge && gs.pendingCharge.fromPlayerId === action.playerId
        && priorPlayedCard && gs.pendingCharge.sourceTitle === priorPlayedCard.title) {
        const pending = gs.pendingCharge;
        const debtorIds = Object.keys(pending.debtors);
        const amount = debtorIds.length ? pending.debtors[debtorIds[0]].amountOwed : 0;
        const debtorNames = debtorIds.map(id => playerDisplayName(room, gs, id)).join(', ');
        const rentColor = pending.rentColor ? ` (${pending.rentColor})` : '';
        const doubledNote = pending.doubled ? ' with Double The Rent (doubled)' : '';
        return `${actorName} played ${pending.sourceTitle}${rentColor}${doubledNote} — ${debtorNames} must pay $${amount}M.`;
    }
    if (action.type === 'PLAY_ACTION_CARD' && priorPlayedCard && priorPlayedCard.title === 'Sly Deal'
        && action.targetPlayerId && action.targetPropertyColor && action.targetCardId) {
        const priorTargetGroup = previousGameState.players[action.targetPlayerId]
            && previousGameState.players[action.targetPlayerId].properties[action.targetPropertyColor];
        const stolenCard = priorTargetGroup && priorTargetGroup.cards
            && priorTargetGroup.cards.find(c => c.id === action.targetCardId);
        if (stolenCard) {
            const targetName = playerDisplayName(room, gs, action.targetPlayerId);
            const stolenTitle = stolenCard.title || stolenCard.name || 'a property';
            return `${actorName} used Sly Deal to steal ${stolenTitle} (${action.targetPropertyColor}) from ${targetName}.`;
        }
    }

    if (action.type === 'PLAY_ACTION_CARD' && priorPlayedCard && priorPlayedCard.title === 'Forced Deal'
        && action.targetPlayerId && action.offeredCardId && action.offeredPropertyColor
        && action.requestedCardId && action.requestedPropertyColor) {
        const priorActor = previousGameState.players[action.playerId];
        const priorTarget = previousGameState.players[action.targetPlayerId];
        const priorOfferGroup = priorActor && priorActor.properties[action.offeredPropertyColor];
        const priorRequestGroup = priorTarget && priorTarget.properties[action.requestedPropertyColor];
        const offeredCard = priorOfferGroup && priorOfferGroup.cards
            && priorOfferGroup.cards.find(c => c.id === action.offeredCardId);
        const requestedCard = priorRequestGroup && priorRequestGroup.cards
            && priorRequestGroup.cards.find(c => c.id === action.requestedCardId);
        if (offeredCard && requestedCard) {
            const targetName = playerDisplayName(room, gs, action.targetPlayerId);
            const offeredTitle = offeredCard.title || offeredCard.name || 'a property';
            const requestedTitle = requestedCard.title || requestedCard.name || 'a property';
            return `${actorName} used Forced Deal to swap ${offeredTitle} (${action.offeredPropertyColor}) for ${targetName}'s ${requestedTitle} (${action.requestedPropertyColor}).`;
        }
    }

    if (action.type === 'PLAY_ACTION_CARD' && priorPlayedCard && priorPlayedCard.title === 'Deal Breaker'
        && action.targetPlayerId && action.targetPropertyColor) {
        const priorTarget = previousGameState.players[action.targetPlayerId];
        const priorGroup = priorTarget && priorTarget.properties[action.targetPropertyColor];
        if (priorGroup && Array.isArray(priorGroup.cards)) {
            const targetName = playerDisplayName(room, gs, action.targetPlayerId);
            const buildings = [priorGroup.hasHouse && 'house', priorGroup.hasHotel && 'hotel'].filter(Boolean);
            const buildingSuffix = buildings.length ? ` (with ${buildings.join(' and ')})` : '';
            return `${actorName} used Deal Breaker to steal ${targetName}'s complete ${action.targetPropertyColor} set${buildingSuffix}.`;
        }
    }

    if (action.type === 'PLAY_ACTION_CARD' && priorPlayedCard && priorPlayedCard.title === 'Pass Go') {
        const priorHandSize = previousGameState.players[action.playerId].hand.length;
        const currentHandSize = (gs.players[action.playerId].hand || []).length;
        const drawn = Math.max(0, currentHandSize - (priorHandSize - 1));
        return `${actorName} played Pass Go and drew ${drawn} card${drawn === 1 ? '' : 's'}.`;
    }

    if (action.type === 'PAY_RENT') {
        const priorPending = previousGameState.pendingCharge;
        const debtorEntry = priorPending && priorPending.debtors && priorPending.debtors[action.playerId];
        if (priorPending && debtorEntry) {
            const recipientName = playerDisplayName(room, gs, priorPending.fromPlayerId);
            return `${actorName} paid $${debtorEntry.amountOwed}M to ${recipientName} for ${priorPending.sourceTitle}.`;
        }
        return `${actorName} settled a pending payment.`;
    }

    // Wildcard Rearrange: a free board reorganization that moves one already-
    // placed wildcard from one color group to another. Report both ends so the
    // feed reads accurately even when the source group was emptied and removed.
    if (action.type === 'REARRANGE' && action.cardId && action.propertyColor) {
        const priorProps = (previousGameState.players[action.playerId]
            && previousGameState.players[action.playerId].properties) || {};
        let fromColor = null;
        Object.keys(priorProps).forEach(color => {
            const grp = priorProps[color];
            if (grp && Array.isArray(grp.cards) && grp.cards.some(c => c.id === action.cardId)) {
                fromColor = color;
            }
        });
        const humanize = (c) => c.replace(/([a-z])([A-Z])/g, '$1 $2');
        const to = humanize(action.propertyColor);
        return fromColor
            ? `${actorName} moved a wildcard from their ${humanize(fromColor)} set to ${to}.`
            : `${actorName} reassigned a wildcard to ${to}.`;
    }

    return `${actorName} performed ${action.type}`;
}

function selectBotPayableAssetIds(gameState, playerId, amountOwed) {
    const player = gameState && gameState.players && gameState.players[playerId];
    if (!player) return [];

    const candidates = [];
    (player.bank || []).forEach(card => {
        candidates.push({ cardId: card.id, value: card.value || 0, zone: 'bank' });
    });
    Object.keys(player.properties || {}).forEach(color => {
        const group = player.properties[color] || { cards: [] };
        (group.cards || []).forEach(card => {
            candidates.push({ cardId: card.id, value: card.value || 0, zone: 'properties' });
        });
    });

    candidates.sort((a, b) => (a.value - b.value) || a.cardId.localeCompare(b.cardId));
    const selected = [];
    let total = 0;
    for (const candidate of candidates) {
        if (total >= amountOwed) break;
        selected.push(candidate.cardId);
        total += candidate.value;
    }
    return selected;
}

// Auto-settles any bot seats currently listed as debtors on a pending charge
// (Debt Collector / Its My Birthday), using payable bank/property assets only.
// Stops as soon as only human debtors remain, since those require a human to
// act through the PaymentModal.
function settlePendingBotDebts(roomCode) {
    const room = room_registry.getRoom(roomCode);
    if (!room || !room.gameState) return;

    let iterations = 0;
    while (room.gameState.pendingCharge && iterations < MAX_BOT_TURN_ITERATIONS) {
        const pending = room.gameState.pendingCharge;
        const botDebtorId = Object.keys(pending.debtors).find(id => {
            const seat = room.seats.find(s => s.playerId === id);
            return seat && seat.isBot;
        });
        if (!botDebtorId) break;

        iterations += 1;
        const amountOwed = pending.debtors[botDebtorId].amountOwed;
        // Keep payment_optimizer consulted for continuity with the bot payment lane,
        // but settle through payable board assets only (bank/properties). Monopoly
        // Deal payments cannot come from hand cards, and the browser PaymentModal
        // intentionally exposes only bank + property assets.
        try {
            payment_optimizer.optimizeDebtPayment(room.gameState, botDebtorId, { amountOwed });
        } catch (err) {
            console.warn(`[Bot] Payment optimizer unavailable for ${botDebtorId}: ${err.message}`);
        }
        const paymentCardIds = selectBotPayableAssetIds(room.gameState, botDebtorId, amountOwed);

        const previousGameState = room.gameState;
        const result = game_manager.applyAction(room.gameState, {
            type: 'PAY_RENT',
            playerId: botDebtorId,
            paymentCardIds
        });

        if (!result.legal) {
            console.error(`[Bot] Failed to auto-settle pending charge for ${botDebtorId}: ${result.reason}`);
            break;
        }

        room.gameState = result.gameState;
        room.seq += 1;

        io.to(`room:${roomCode}`).emit('game:event', {
            seq: room.seq,
            ts: Date.now(),
            playerId: botDebtorId,
            action: 'PAY_RENT',
            summary: buildActionEventSummary(room, { type: 'PAY_RENT', playerId: botDebtorId }, previousGameState)
        });

        room.seats.forEach(s => {
            if (s.isBot) return;
            io.to(s.playerId).emit('game:state', room_registry.toClientView(room, s.playerId));
        });

        if (emitGameOverIfFinished(room, roomCode)) {
            break;
        }
    }
}

function botStepToAction(step, playerId) {
    switch (step.type) {
        case 'DRAW':
            return { type: 'DRAW', playerId };
        case 'DISCARD':
            return { type: 'DISCARD', playerId, cardId: step.cardId };
        case 'END_TURN':
            return { type: 'END_TURN', playerId };
        case 'PLAY_ACTION_CARD': {
            const action = {
                type: 'PLAY_ACTION_CARD',
                playerId,
                cardId: step.cardId,
                targetZone: 'action'
            };
            if (step.targetPlayerId) action.targetPlayerId = step.targetPlayerId;
            if (step.propertyColor) action.propertyColor = step.propertyColor;
            if (step.targetPropertyColor) action.targetPropertyColor = step.targetPropertyColor;
            if (step.targetCardId) action.targetCardId = step.targetCardId;
            if (step.offeredCardId) action.offeredCardId = step.offeredCardId;
            if (step.offeredPropertyColor) action.offeredPropertyColor = step.offeredPropertyColor;
            if (step.requestedCardId) action.requestedCardId = step.requestedCardId;
            if (step.requestedPropertyColor) action.requestedPropertyColor = step.requestedPropertyColor;
            if (step.doubleRentCardId) action.doubleRentCardId = step.doubleRentCardId;
            return action;
        }
        case 'PLAY':
        case 'BANK':
            return { type: 'PLAY_CARD', playerId, cardId: step.cardId, targetZone: step.targetZone, propertyColor: step.propertyColor };
        case 'BLOCKED':
        case 'WIN':
        default:
            return null;
    }
}

// Drives bot seats' turns automatically using the existing turn planner, replaying its
// planned steps through the authoritative game_manager.applyAction pipeline so bots never
// bypass normal rules validation. Stops as soon as control returns to a human seat.
function driveBotTurns(roomCode) {
    const room = room_registry.getRoom(roomCode);
    if (!room || !room.gameState || room.status !== 'IN_PROGRESS') return;

    let iterations = 0;
    while (iterations < MAX_BOT_TURN_ITERATIONS) {
        const gs = room.gameState;
        if (!gs || gs.status === 'FINISHED') break;
        const currentPlayerId = gs.turn ? gs.turn.playerId : null;
        if (!currentPlayerId) break;

        const seat = room.seats.find(s => s.playerId === currentPlayerId);
        if (!seat || !seat.isBot) break;

        iterations += 1;

        // turn_planner's internal DRAW step omits the required `count`, so it never
        // succeeds against the real validator. Pre-draw here against the authoritative
        // state so the planner picks up from the ACTION phase.
        if (gs.turn.phase === 'DRAW' && !gs.turn.hasDrawn) {
            const requiredCount = gs.turn.handSizeAtStartOfTurn === 0 ? 5 : 2;
            const drawResult = game_manager.applyAction(room.gameState, { type: 'DRAW', playerId: currentPlayerId, count: requiredCount });
            if (drawResult.legal) {
                room.gameState = drawResult.gameState;
                room.seq += 1;
                io.to(`room:${roomCode}`).emit('game:event', {
                    seq: room.seq,
                    ts: Date.now(),
                    playerId: currentPlayerId,
                    action: 'DRAW',
                    summary: `${seat.displayName} drew ${requiredCount} card(s).`
                });
            }
        }

        let plan;
        try {
            plan = turn_planner.planTurnActionSequence(room.gameState, currentPlayerId, { difficultyLevel: seat.difficulty || 'MEDIUM' });
        } catch (err) {
            console.error(`[Bot] Failed to plan turn for ${currentPlayerId}:`, err);
            break;
        }

        if (!plan || !plan.steps || plan.steps.length === 0) break;

        let appliedAny = false;
        for (const step of plan.steps) {
            const action = botStepToAction(step, currentPlayerId);
            if (!action) continue;

            const previousGameState = room.gameState;
            const result = game_manager.applyAction(room.gameState, action);
            if (!result.legal) continue;

            room.gameState = result.gameState;
            room.seq += 1;
            appliedAny = true;

            io.to(`room:${roomCode}`).emit('game:event', {
                seq: room.seq,
                ts: Date.now(),
                playerId: currentPlayerId,
                action: action.type,
                summary: buildActionEventSummary(room, action, previousGameState)
            });

            // A win or a parked charge suspends the rest of the plan: nothing
            // further is legal until the game ends / the charge is settled.
            if (room.gameState.status === 'FINISHED' || room.gameState.pendingCharge) break;
        }

        room.seats.forEach(s => {
            if (s.isBot) return;
            io.to(s.playerId).emit('game:state', room_registry.toClientView(room, s.playerId));
        });

        // Settle any charge the bot just raised against other bots. Bot->human
        // debt is left parked for the human's PaymentModal.
        settlePendingBotDebts(roomCode);

        if (room.gameState.status === 'FINISHED') {
            // settlePendingBotDebts calls emitGameOverIfFinished itself (not
            // idempotent), so only emit here if it hasn't already.
            if (room.status !== 'FINISHED') emitGameOverIfFinished(room, roomCode);
            break;
        }

        if (rules_validator.hasOutstandingPendingCharge(room.gameState)) {
            room.seats.forEach(s => {
                if (!s.isBot) io.to(s.playerId).emit('game:state', room_registry.toClientView(room, s.playerId));
            });
            return; // a human owes; wait for their PAY_RENT to resume the bot
        }

        if (!appliedAny) break;
    }
}

io.on('connection', function(socket) {
    console.log(`[Socket] Connected: ${socket.id}`);
    let currentRoomCode = null;

    socket.on("disconnect", function() {
        console.log(`[Socket] Disconnected: ${socket.id}`);
        if (currentRoomCode) {
            const room = room_registry.getRoom(currentRoomCode);
            if (room) {
                const seat = room.seats.find(s => s.playerId === socket.id);
                if (seat) seat.connected = false;
                io.to(`room:${currentRoomCode}`).emit('room:state', room_registry.toRoomState(room));
            }
        }
    });

    // --- Canonical Socket.IO Protocol Handlers ---

    // 1. room:create
    socket.on('room:create', function(data) {
        const displayName = data && data.displayName ? data.displayName : 'Host Player';
        const room = room_registry.createRoom(socket.id, displayName);
        currentRoomCode = room.roomCode;
        socket.join(`room:${room.roomCode}`);

        console.log(`[Room] Created room ${room.roomCode} by ${displayName} (${socket.id})`);
        socket.emit('room:state', room_registry.toRoomState(room));
    });

    // 2. room:join
    socket.on('room:join', function(data) {
        if (!data || !data.roomCode) {
            return socket.emit('game:action-rejected', { reason: 'Room code required' });
        }
        const roomCode = data.roomCode.toUpperCase();
        const displayName = data.displayName || 'Player';

        const result = room_registry.joinRoom(roomCode, socket.id, displayName);
        if (result.error) {
            return socket.emit('game:action-rejected', { reason: result.error });
        }

        currentRoomCode = roomCode;
        socket.join(`room:${roomCode}`);

        console.log(`[Room] Player ${displayName} (${socket.id}) joined room ${roomCode}`);
        io.to(`room:${roomCode}`).emit('room:state', room_registry.toRoomState(result.room));
    });

    // room:add-bot (host-only, lobby-only)
    socket.on('room:add-bot', function(data) {
        if (!currentRoomCode) {
            return socket.emit('game:action-rejected', { reason: 'Not in a room' });
        }
        const room = room_registry.getRoom(currentRoomCode);
        if (!room) return socket.emit('game:action-rejected', { reason: 'Room not found' });

        if (room.hostPlayerId !== socket.id) {
            return socket.emit('game:action-rejected', { reason: 'Only host can add a bot' });
        }
        if (room.status !== 'LOBBY') {
            return socket.emit('game:action-rejected', { reason: 'Bots can only be added while in the lobby' });
        }

        const displayName = (data && data.displayName) || 'Jarvis Bot';
        const difficulty = (data && data.difficulty) || 'MEDIUM';
        const result = room_registry.addBotSeat(currentRoomCode, displayName, difficulty);
        if (result.error) {
            return socket.emit('game:action-rejected', { reason: result.error });
        }

        console.log(`[Room] Bot seat "${displayName}" added to room ${currentRoomCode}`);
        io.to(`room:${currentRoomCode}`).emit('room:state', room_registry.toRoomState(result.room));
    });

    // 3. room:start
    socket.on('room:start', function() {
        if (!currentRoomCode) {
            return socket.emit('game:action-rejected', { reason: 'Not in a room' });
        }
        const room = room_registry.getRoom(currentRoomCode);
        if (!room) return socket.emit('game:action-rejected', { reason: 'Room not found' });

        if (room.hostPlayerId !== socket.id) {
            return socket.emit('game:action-rejected', { reason: 'Only host can start match' });
        }

        if (room.seats.length < 2) {
            return socket.emit('game:action-rejected', { reason: 'At least 2 players required' });
        }

        const formattedPlayers = room.seats.map(s => ({
            id: s.playerId,
            name: s.displayName
        }));

        room.gameState = game_manager.createGameState(formattedPlayers);
        room.status = 'IN_PROGRESS';

        // Auto-draw initial turn cards
        const firstPlayerId = room.gameState.turn.playerId;
        const drawResult = game_manager.applyAction(room.gameState, {
            type: 'DRAW',
            playerId: firstPlayerId,
            count: 2
        });
        if (drawResult.legal) {
            room.gameState = drawResult.gameState;
        }

        room.seq += 1;
        console.log(`[Game] Match started in room ${currentRoomCode}`);

        // Broadcast room state and individual redacted game states
        io.to(`room:${currentRoomCode}`).emit('room:state', room_registry.toRoomState(room));

        room.seats.forEach(s => {
            if (s.isBot) return;
            const clientState = room_registry.toClientView(room, s.playerId);
            io.to(s.playerId).emit('game:state', clientState);
        });

        io.to(`room:${currentRoomCode}`).emit('game:event', {
            seq: room.seq,
            ts: Date.now(),
            playerId: firstPlayerId,
            action: 'START',
            summary: `Match started! It's ${room.gameState.players[firstPlayerId].name}'s turn.`
        });

        driveBotTurns(currentRoomCode);
    });

    // room:rematch / room:reset
    socket.on('room:rematch', function(data) {
        const roomCode = (data && data.roomCode ? data.roomCode : currentRoomCode || '').toUpperCase();
        if (!roomCode) {
            return socket.emit('game:action-rejected', { reason: 'Not in a room' });
        }
        const room = room_registry.getRoom(roomCode);
        if (!room) return socket.emit('game:action-rejected', { reason: 'Room not found' });

        const seat = room.seats.find(s => s.playerId === socket.id);
        if (!seat) {
            return socket.emit('game:action-rejected', { reason: 'Must be seated in room to request rematch' });
        }

        const resetRes = room_registry.resetRoom(roomCode);
        if (resetRes.error) {
            return socket.emit('game:action-rejected', { reason: resetRes.error });
        }

        console.log(`[Room] Rematch executed in room ${roomCode} by ${socket.id}`);
        io.to(`room:${roomCode}`).emit('room:state', room_registry.toRoomState(resetRes.room));
        io.to(`room:${roomCode}`).emit('game:state', null);
        io.to(`room:${roomCode}`).emit('game:event', {
            seq: 0,
            ts: Date.now(),
            playerId: socket.id,
            action: 'REMATCH',
            summary: 'Room returned to lobby for a rematch.'
        });
    });

    socket.on('room:reset', function(data) {
        const roomCode = (data && data.roomCode ? data.roomCode : currentRoomCode || '').toUpperCase();
        if (!roomCode) {
            return socket.emit('game:action-rejected', { reason: 'Not in a room' });
        }
        const room = room_registry.getRoom(roomCode);
        if (!room) return socket.emit('game:action-rejected', { reason: 'Room not found' });

        const resetRes = room_registry.resetRoom(roomCode);
        if (resetRes.error) {
            return socket.emit('game:action-rejected', { reason: resetRes.error });
        }

        console.log(`[Room] Reset executed in room ${roomCode} by ${socket.id}`);
        io.to(`room:${roomCode}`).emit('room:state', room_registry.toRoomState(resetRes.room));
        io.to(`room:${roomCode}`).emit('game:state', null);
        io.to(`room:${roomCode}`).emit('game:event', {
            seq: 0,
            ts: Date.now(),
            playerId: socket.id,
            action: 'REMATCH',
            summary: 'Room was reset to lobby state.'
        });
    });

    // 4. game:action
    socket.on('game:action', function(actionData) {
        if (!currentRoomCode) {
            return socket.emit('game:action-rejected', { reason: 'Not in a room' });
        }
        const room = room_registry.getRoom(currentRoomCode);
        if (!room || !room.gameState) {
            return socket.emit('game:action-rejected', { reason: 'No active match' });
        }

        const action = {
            ...actionData,
            playerId: socket.id
        };

        const previousGameState = room.gameState;
        const result = game_manager.applyAction(room.gameState, action);
        if (!result.legal) {
            return socket.emit('game:action-rejected', { reason: result.reason || 'Illegal action' });
        }

        room.gameState = result.gameState;
        room.seq += 1;

        // Broadcast updated client views
        room.seats.forEach(s => {
            if (s.isBot) return;
            const clientState = room_registry.toClientView(room, s.playerId);
            io.to(s.playerId).emit('game:state', clientState);
        });

        io.to(`room:${currentRoomCode}`).emit('game:event', {
            seq: room.seq,
            ts: Date.now(),
            playerId: socket.id,
            action: action.type,
            summary: buildActionEventSummary(room, action, previousGameState)
        });

        if (emitGameOverIfFinished(room, currentRoomCode)) {
            return;
        }

        settlePendingBotDebts(currentRoomCode);

        const hasOutstandingHumanDebt = !!(room.gameState.pendingCharge && Object.keys(room.gameState.pendingCharge.debtors || {}).length > 0);
        if (!hasOutstandingHumanDebt) {
            driveBotTurns(currentRoomCode);
        }
    });

    // 5. game:resync
    socket.on('game:resync', function() {
        if (!currentRoomCode) return;
        const room = room_registry.getRoom(currentRoomCode);
        if (!room) return;

        socket.emit('room:state', room_registry.toRoomState(room));
        if (room.gameState) {
            socket.emit('game:state', room_registry.toClientView(room, socket.id));
        }
    });
});

app.get("/api/monopoly/bot/discard-rules", function(req, res) {
    try {
        const rules = discard_optimizer.getDiscardRulesCatalog();
        return res.json({ status: "ok", count: rules.length, rules });
    } catch (err) {
        console.error('[bot/discard-rules] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving discard rules" });
    }
});

app.post("/api/monopoly/bot/optimize-discards", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, playerId } = req.body || {};
        if (!playerId || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "playerId and either roomId or gameState are required" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[playerId]) {
            return res.status(400).json({ status: "error", message: "playerId not found in gameState.players" });
        }

        const plan = discard_optimizer.optimizeTurnEndDiscards(gameState, playerId);
        return res.json({ status: "ok", plan });
    } catch (err) {
        if (err.message && (err.message.includes('Invalid gameState') || err.message.includes('not found'))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/optimize-discards] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error optimizing turn-end discards" });
    }
});

app.get("/api/monopoly/bot/payment-rules", function(req, res) {
    try {
        const rules = payment_optimizer.getPaymentRulesCatalog();
        return res.json({ status: "ok", count: rules.length, rules });
    } catch (err) {
        console.error('[bot/payment-rules] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving payment rules" });
    }
});

app.post("/api/monopoly/bot/optimize-payment", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, playerId, amountOwed, debtSource } = req.body || {};
        if (!playerId || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "playerId and either roomId or gameState are required" });
        }
        if (amountOwed === undefined && !debtSource) {
            return res.status(400).json({ status: "error", message: "amountOwed or debtSource is required" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[playerId]) {
            return res.status(400).json({ status: "error", message: "playerId not found in gameState.players" });
        }

        const plan = payment_optimizer.optimizeDebtPayment(gameState, playerId, { amountOwed, debtSource });
        return res.json({ status: "ok", plan });
    } catch (err) {
        if (err.message && (err.message.startsWith('Unknown debtSource type') || err.message.includes('not found') || err.message.includes('must provide'))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/optimize-payment] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error optimizing debt payment" });
    }
});

app.get("/api/monopoly/bot/rent-mitigation-rules", function(req, res) {
    try {
        const rules = rent_mitigation_optimizer.getRentMitigationCatalog();
        return res.json({ status: "ok", count: rules.length, rules });
    } catch (err) {
        console.error('[bot/rent-mitigation-rules] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving rent mitigation rules" });
    }
});

app.post("/api/monopoly/bot/optimize-rent-defense", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, payerId, ownerId, propertyColor } = req.body || {};
        if (!payerId || !ownerId || !propertyColor || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "payerId, ownerId, propertyColor, and either roomId or gameState are required" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[payerId] || !gameState.players[ownerId]) {
            return res.status(400).json({ status: "error", message: "payerId or ownerId not found in gameState.players" });
        }

        const defense = rent_mitigation_optimizer.optimizeRentDefense(gameState, payerId, ownerId, propertyColor);
        return res.json({ status: "ok", defense });
    } catch (err) {
        if (err.message && (err.message.includes('cannot be the same') || err.message.includes('not found') || err.message.includes('Invalid'))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/optimize-rent-defense] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error optimizing rent defense" });
    }
});

app.get("/api/monopoly/bot/dealbreaker-mitigation-tactics", function(req, res) {
    try {
        const tactics = dealbreaker_defense.getThreatMitigationCatalog();
        return res.json({ status: "ok", count: tactics.length, tactics });
    } catch (err) {
        console.error('[bot/dealbreaker-mitigation-tactics] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving mitigation tactics" });
    }
});

app.post("/api/monopoly/bot/assess-dealbreaker-threat", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, playerId } = req.body || {};
        if (!playerId || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "playerId and either roomId or gameState are required" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[playerId]) {
            return res.status(400).json({ status: "error", message: "playerId not found in gameState.players" });
        }

        const plan = dealbreaker_defense.recommendDefensiveCounterPlay(gameState, playerId);
        return res.json({ status: "ok", plan });
    } catch (err) {
        if (err.message && (err.message.includes('Invalid') || err.message.includes('not found'))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/assess-dealbreaker-threat] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error assessing Deal Breaker threat" });
    }
});

app.get("/api/monopoly/bot/turn-planning-tactics", function(req, res) {
    try {
        const tactics = turn_planner.getTurnPlanningTacticsCatalog();
        return res.json({ status: "ok", count: Object.keys(tactics).length, tactics });
    } catch (err) {
        console.error('[bot/turn-planning-tactics] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving turn planning tactics" });
    }
});

app.post("/api/monopoly/bot/plan-turn", function(req, res) {
    try {
        const { roomId, gameState: rawGameState, playerId, forceTactic, difficultyLevel, handicapParams, maxSteps } = req.body || {};
        if (!playerId || (!roomId && !rawGameState)) {
            return res.status(400).json({ status: "error", message: "playerId and either roomId or gameState are required" });
        }
        if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20)) {
            return res.status(400).json({ status: "error", message: "maxSteps must be an integer between 1 and 20" });
        }
        let gameState = rawGameState;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            gameState = room.gameState;
        }
        if (!gameState.players || !gameState.players[playerId]) {
            return res.status(400).json({ status: "error", message: "playerId not found in gameState.players" });
        }

        const plan = turn_planner.planTurnActionSequence(gameState, playerId, { forceTactic, difficultyLevel, handicapParams, maxSteps });
        return res.json({ status: "ok", plan });
    } catch (err) {
        if (err.message && (err.message.startsWith('Unknown turn planning tactic') || err.message.startsWith('Unknown difficulty level') || err.message.includes('Invalid') || err.message.includes('not found'))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/plan-turn] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error planning turn action sequence" });
    }
});

app.get("/api/monopoly/bot/tendency-categories", function(req, res) {
    try {
        const categories = opponent_profiler.getTendencyCategoriesCatalog();
        return res.json({ status: "ok", count: categories.length, categories });
    } catch (err) {
        console.error('[bot/tendency-categories] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving tendency categories" });
    }
});

app.post("/api/monopoly/bot/profile-opponent", function(req, res) {
    try {
        const { opponentKey, observation, includeRecommendations = true } = req.body || {};
        if (!opponentKey || typeof opponentKey !== 'string') {
            return res.status(400).json({ status: "error", message: "opponentKey (non-empty string) is required" });
        }

        let recorded = null;
        if (observation !== undefined) {
            recorded = opponent_profiler.recordOpponentObservedAction(opponentKey, observation);
        }

        let profile;
        try {
            profile = opponent_profiler.calculateOpponentBehaviorProfile(opponentKey);
        } catch (profileErr) {
            return res.status(404).json({ status: "error", message: profileErr.message });
        }

        const recommendations = includeRecommendations
            ? opponent_profiler.recommendCounterTacticsForProfile(opponentKey).recommendations
            : undefined;

        return res.json({ status: "ok", recorded, profile, recommendations });
    } catch (err) {
        if (err.message && (err.message.includes("actionType") || err.message.includes("cardTitle") || err.message.includes("opponentKey"))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/profile-opponent] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error profiling opponent" });
    }
});

app.get("/api/monopoly/bot/replay-metric-types", function(req, res) {
    try {
        const metrics = match_replay_analyzer.getReplayMetricTypesCatalog();
        return res.json({ status: "ok", count: metrics.length, metrics });
    } catch (err) {
        console.error('[bot/replay-metric-types] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving replay metric types" });
    }
});

app.post("/api/monopoly/bot/analyze-match-replay", function(req, res) {
    try {
        const { roomId, historyEvents: rawHistoryEvents, mode } = req.body || {};

        let historyEvents = rawHistoryEvents;
        if (roomId) {
            const room = room_registry.getRoom((roomId || '').toUpperCase());
            if (!room) return res.status(404).json({ status: "error", message: "Room not found" });
            if (!room.gameState) return res.status(409).json({ status: "error", message: "Room has no active game" });
            historyEvents = room.gameState.replayLogs;
        }

        if (!Array.isArray(historyEvents) || historyEvents.length === 0) {
            return res.status(400).json({ status: "error", message: "historyEvents (non-empty array) or a valid roomId with replay history is required" });
        }
        if (historyEvents.length > blunder_analyzer.MAX_REPLAY_LOG_ENTRIES) {
            return res.status(400).json({ status: "error", message: `historyEvents exceeds max allowed entries (${blunder_analyzer.MAX_REPLAY_LOG_ENTRIES})` });
        }

        if (mode === "summary") {
            const summary = match_replay_analyzer.generateStrategicMatchSummary(historyEvents);
            return res.json({ status: "ok", summary });
        }

        const analysis = match_replay_analyzer.analyzeMatchReplay(historyEvents);
        return res.json({ status: "ok", analysis });
    } catch (err) {
        if (err.message && (err.message.includes('must be a non-empty array') || err.message.includes('no boardSnapshotSummary'))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/analyze-match-replay] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error analyzing match replay" });
    }
});

app.get("/api/monopoly/bot/benchmark-metric-types", function(req, res) {
    try {
        const metricTypes = replay_benchmark_evaluator.getBenchmarkMetricTypesCatalog();
        return res.json({ status: "ok", count: metricTypes.length, metricTypes });
    } catch (err) {
        console.error('[bot/benchmark-metric-types] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving benchmark metric types" });
    }
});

app.post("/api/monopoly/bot/compare-match-replays", function(req, res) {
    try {
        const { seriesList } = req.body || {};
        if (!Array.isArray(seriesList) || seriesList.length < 2) {
            return res.status(400).json({ status: "error", message: "seriesList must be an array of at least 2 replay series" });
        }
        const comparison = replay_benchmark_evaluator.compareReplaySeries(seriesList);
        return res.json({ status: "ok", comparison });
    } catch (err) {
        if (err.message && (err.message.includes("Duplicate seriesId") || err.message.includes("non-empty matches array") || err.message.includes("at least 2 replay series") || err.message.includes("requires a"))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/compare-match-replays] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error comparing match replay series" });
    }
});

app.get("/api/monopoly/bot/strategy-tuning-rules", function(req, res) {
    try {
        const rules = replay_strategy_tuner.getTuningRulesCatalog();
        return res.json({ status: "ok", count: rules.length, rules });
    } catch (err) {
        console.error('[bot/strategy-tuning-rules] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving strategy tuning rules" });
    }
});

app.post("/api/monopoly/bot/recommend-strategy-tuning", function(req, res) {
    try {
        const { seriesList, comparison: rawComparison, targetSeriesId, currentParams } = req.body || {};

        if (!targetSeriesId || typeof targetSeriesId !== "string") {
            return res.status(400).json({ status: "error", message: "targetSeriesId (string) is required" });
        }

        let comparison = rawComparison;
        if (!comparison) {
            if (!Array.isArray(seriesList) || seriesList.length < 2) {
                return res.status(400).json({ status: "error", message: "Either comparison or seriesList (array of at least 2 replay series) is required" });
            }
            comparison = replay_benchmark_evaluator.compareReplaySeries(seriesList);
        }

        const recommendation = replay_strategy_tuner.generateStrategyTuningRecommendations(comparison, targetSeriesId, currentParams);
        return res.json({ status: "ok", recommendation });
    } catch (err) {
        if (err.message && (err.message.includes("requires a") || err.message.includes("No series summary found") || err.message.includes("Duplicate seriesId") || err.message.includes("non-empty matches array") || err.message.includes("at least 2 replay series"))) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/recommend-strategy-tuning] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error generating strategy tuning recommendations" });
    }
});

app.get("/api/monopoly/bot/meta-strategy-rules", function(req, res) {
    try {
        const rules = tournament_meta_adaptor.getMetaStrategyRulesCatalog();
        return res.json({ status: "ok", count: rules.length, rules });
    } catch (err) {
        console.error('[bot/meta-strategy-rules] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving meta-strategy rules" });
    }
});

app.post("/api/monopoly/bot/adapt-tournament-strategy", function(req, res) {
    try {
        const { standings: rawStandings, series, replaySummaries, currentStrategy } = req.body || {};

        if (!currentStrategy || typeof currentStrategy !== "string") {
            return res.status(400).json({ status: "error", message: "currentStrategy (string) is required" });
        }

        let standings = rawStandings;
        if (!standings) {
            if (!series || !Array.isArray(series.matches)) {
                return res.status(400).json({ status: "error", message: "Either standings or series (tournament_runner.simulateTournamentSeries output) is required" });
            }
            standings = tournament_runner.evaluateTournamentStandings(series);
        }

        const tournamentMeta = tournament_meta_adaptor.evaluateTournamentMetaDivergence(standings, replaySummaries);
        const adaptation = tournament_meta_adaptor.adaptTournamentMetaStrategy(currentStrategy, tournamentMeta);

        return res.json({ status: "ok", tournamentMeta, adaptation });
    } catch (err) {
        if (err.message && (
            err.message.includes("requires a") ||
            err.message.includes("Unknown strategy")
        )) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/adapt-tournament-strategy] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error adapting tournament meta-strategy" });
    }
});

app.get("/api/monopoly/bot/elo-rating-tiers", function(req, res) {
    try {
        const tiers = league_elo_calculator.getEloRatingTiersCatalog();
        return res.json({ status: "ok", count: tiers.length, tiers });
    } catch (err) {
        console.error('[bot/elo-rating-tiers] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving Elo rating tiers" });
    }
});

app.post("/api/monopoly/bot/calculate-league-elo", function(req, res) {
    try {
        const { participants, matchResult, kFactor, ratingHistories } = req.body || {};
        if (!Array.isArray(participants) || participants.length < 2) {
            return res.status(400).json({ status: "error", message: "participants must be an array of at least 2 entries" });
        }

        const eloResult = league_elo_calculator.calculateMultiplayerEloDeltas(participants, matchResult || {}, { kFactor });

        const skillDrift = {};
        if (ratingHistories && typeof ratingHistories === "object") {
            eloResult.participants.forEach(p => {
                const priorHistory = Array.isArray(ratingHistories[p.id]) ? ratingHistories[p.id] : null;
                if (priorHistory) {
                    skillDrift[p.id] = league_elo_calculator.detectSkillDrift([...priorHistory, p.newRating]);
                }
            });
        }

        return res.json({ status: "ok", eloResult, skillDrift });
    } catch (err) {
        if (err.message && (
            err.message.includes("requires at least 2 participants") ||
            err.message.includes("unique id values") ||
            err.message.includes("does not match any participant") ||
            err.message.includes("requires a non-empty ratingHistory") ||
            err.message.includes("requires numeric rating values")
        )) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/calculate-league-elo] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error calculating league Elo ratings" });
    }
});

app.get("/api/monopoly/bot/season-tiers", function(req, res) {
    try {
        const tiers = league_season_manager.getSeasonTiersCatalog();
        return res.json({ status: "ok", count: tiers.length, tiers });
    } catch (err) {
        console.error('[bot/season-tiers] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error retrieving season tiers catalog" });
    }
});

app.post("/api/monopoly/bot/calculate-season-standings", function(req, res) {
    try {
        const { matchResults } = req.body || {};
        if (!Array.isArray(matchResults)) {
            return res.status(400).json({ status: "error", message: "matchResults must be an array" });
        }
        const standings = league_season_manager.calculateSeasonRankings(matchResults);
        return res.json({ status: "ok", count: standings.length, standings });
    } catch (err) {
        if (err.message && err.message.includes("matchResults must be an array")) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/calculate-season-standings] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error calculating season standings" });
    }
});

app.post("/api/monopoly/bot/evaluate-season-transitions", function(req, res) {
    try {
        const { seasonId, matchResults } = req.body || {};
        if (!Array.isArray(matchResults)) {
            return res.status(400).json({ status: "error", message: "matchResults must be an array" });
        }
        const transitionSummary = league_season_manager.simulateSeasonTransition(seasonId || 'SEASON-1', matchResults);
        return res.json({ status: "ok", transitionSummary });
    } catch (err) {
        if (err.message && err.message.includes("matchResults must be an array")) {
            return res.status(400).json({ status: "error", message: err.message });
        }
        console.error('[bot/evaluate-season-transitions] error:', err);
        return res.status(500).json({ status: "error", message: "Internal error evaluating season transitions" });
    }
});

var PORT = process.env.PORT || 9000;
if (require.main === module) {
    http.listen(PORT, function() {
        console.log(`Monopoly Deal Server v1.5 listening on port ${PORT}`);
    });
}

app.http = http;
app.io = io;
// Exposed for focused unit tests of the solo-bot action-card driver lane.
app.__botDriver = { driveBotTurns, settlePendingBotDebts, botStepToAction };
// Exposed for focused unit tests of the human-readable game:event summaries.
app.buildActionEventSummary = buildActionEventSummary;
module.exports = app;
