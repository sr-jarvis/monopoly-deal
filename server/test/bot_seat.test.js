'use strict';

const { expect } = require("chai");
const assert = require("assert");
const ioClient = require("socket.io-client");
const room_registry = require("../room_registry");

describe("Bot Seat — room_registry.addBotSeat", function() {
    it("should add a bot seat with defaults and preserve MAX_SEATS", function() {
        const room = room_registry.createRoom('socket_host_bot_1', 'Host 1');
        const result = room_registry.addBotSeat(room.roomCode);

        assert(!result.error);
        assert.strictEqual(result.room.seats.length, 2);

        const botSeat = result.room.seats[1];
        assert.strictEqual(botSeat.seatIndex, 1);
        assert.strictEqual(botSeat.displayName, 'Jarvis Bot');
        assert.strictEqual(botSeat.isBot, true);
        assert.strictEqual(botSeat.connected, true);
        assert.strictEqual(botSeat.playerId, `bot:${room.roomCode}:1`);
    });

    it("should accept a custom name and difficulty", function() {
        const room = room_registry.createRoom('socket_host_bot_2', 'Host 2');
        const result = room_registry.addBotSeat(room.roomCode, 'Ultron', 'AGGRESSIVE');

        assert(!result.error);
        assert.strictEqual(result.seat.displayName, 'Ultron');
        assert.strictEqual(result.seat.difficulty, 'AGGRESSIVE');
        assert.strictEqual(result.seat.isBot, true);
    });

    it("should not exceed MAX_SEATS when filling a room with bots", function() {
        const room = room_registry.createRoom('socket_host_bot_3', 'Host 3');
        for (let i = 0; i < 4; i++) {
            const res = room_registry.addBotSeat(room.roomCode, `Bot ${i}`);
            assert(!res.error);
        }
        assert.strictEqual(room.seats.length, room_registry.MAX_SEATS);

        const overflow = room_registry.addBotSeat(room.roomCode, 'One Too Many');
        assert.strictEqual(overflow.error, 'Room is full');
        assert.strictEqual(room.seats.length, room_registry.MAX_SEATS);
    });

    it("should return an error for an unknown room", function() {
        const result = room_registry.addBotSeat('NOPE1');
        assert.strictEqual(result.error, 'Room not found');
    });

    it("should surface isBot in toRoomState, listRooms, toRoomDetail, and toClientView", function() {
        const room = room_registry.createRoom('socket_host_bot_4', 'Host 4');
        room_registry.addBotSeat(room.roomCode, 'Jarvis Bot');

        const roomState = room_registry.toRoomState(room);
        assert.strictEqual(roomState.seats[0].isBot, false);
        assert.strictEqual(roomState.seats[1].isBot, true);

        const listed = room_registry.listRooms().find(r => r.roomCode === room.roomCode);
        assert.strictEqual(listed.seats[1].isBot, true);

        const detail = room_registry.toRoomDetail(room);
        assert.strictEqual(detail.seats[1].isBot, true);

        const botId = room.seats[1].playerId;
        room.gameState = {
            turn: { playerId: 'socket_host_bot_4', actionCountRemaining: 3 },
            drawPile: [],
            discardPile: [],
            players: {
                socket_host_bot_4: { hand: [], bank: [], properties: {}, name: 'Host 4' },
                [botId]: { hand: [], bank: [], properties: {}, name: 'Jarvis Bot' }
            }
        };
        const clientView = room_registry.toClientView(room, 'socket_host_bot_4');
        const botOpponent = clientView.opponents.find(o => o.id === botId);
        assert(botOpponent);
        assert.strictEqual(botOpponent.isBot, true);
    });
});

describe("Bot Seat — socket flow (one host + one bot)", function() {
    this.timeout(15000);
    let server;
    let serverPort;
    let client1;
    let app;

    before((done) => {
        app = require("../app");
        server = app.http;
        server.listen(0, () => {
            serverPort = server.address().port;
            done();
        });
    });

    after((done) => {
        if (client1 && client1.connected) client1.disconnect();
        server.close(done);
    });

    it("host can add a bot seat and start a match with one human + one bot", function(done) {
        const url = `http://localhost:${serverPort}`;
        client1 = ioClient(url, { forceNew: true, transports: ["websocket"] });

        let roomCode = null;
        let botAdded = false;
        let matchStarted = false;

        client1.on("game:action-rejected", (err) => {
            done(new Error(`Action rejected: ${JSON.stringify(err)}`));
        });

        client1.on("connect", () => {
            client1.emit("room:create", { displayName: "Solo Host" });
        });

        client1.on("room:state", (roomState) => {
            if (!roomCode && roomState.roomCode) {
                roomCode = roomState.roomCode;
                client1.emit("room:add-bot", { displayName: "Jarvis Bot" });
                return;
            }

            if (!botAdded && roomState.seats.length === 2) {
                botAdded = true;
                const botSeat = roomState.seats.find(s => s.isBot);
                expect(botSeat).to.exist;
                expect(botSeat.displayName).to.equal("Jarvis Bot");
                expect(roomState.status).to.equal("LOBBY");
                client1.emit("room:start");
                return;
            }

            if (!matchStarted && roomState.status === "IN_PROGRESS") {
                matchStarted = true;
                expect(roomState.seats.length).to.equal(2);
            }
        });

        client1.on("game:state", (state) => {
            if (matchStarted && state) {
                expect(state.roomCode).to.equal(roomCode);
                done();
            }
        });
    });

    it("non-host cannot add a bot seat", function(done) {
        const url = `http://localhost:${serverPort}`;
        const hostClient = ioClient(url, { forceNew: true, transports: ["websocket"] });
        const guestClient = ioClient(url, { forceNew: true, transports: ["websocket"], autoConnect: false });
        let roomCode = null;

        const cleanup = (err) => {
            hostClient.disconnect();
            guestClient.disconnect();
            done(err);
        };

        hostClient.on("connect", () => {
            hostClient.emit("room:create", { displayName: "Real Host" });
        });

        hostClient.on("room:state", (roomState) => {
            if (!roomCode && roomState.roomCode) {
                roomCode = roomState.roomCode;
                guestClient.connect();
            }
        });

        guestClient.on("connect", () => {
            guestClient.emit("room:join", { roomCode, displayName: "Guest" });
        });

        guestClient.on("room:state", (roomState) => {
            if (roomState.seats.length === 2) {
                guestClient.emit("room:add-bot", {});
            }
        });

        guestClient.on("game:action-rejected", (err) => {
            try {
                expect(err.reason).to.equal("Only host can add a bot");
                cleanup();
            } catch (assertErr) {
                cleanup(assertErr);
            }
        });
    });
});

describe("Bot Seat — auto turn driver", function() {
    this.timeout(15000);
    let server;
    let serverPort;
    let client1;
    let app;

    before((done) => {
        app = require("../app");
        server = app.http;
        server.listen(0, () => {
            serverPort = server.address().port;
            done();
        });
    });

    after((done) => {
        if (client1 && client1.connected) client1.disconnect();
        server.close(done);
    });

    it("drives the bot's turn without rejection and eventually returns control to the human", function(done) {
        const url = `http://localhost:${serverPort}`;
        client1 = ioClient(url, { forceNew: true, transports: ["websocket"] });

        let roomCode = null;
        let botAdded = false;
        let humanTurnEnded = false;
        let sawBotEvent = false;
        let settledPendingSeq = null;

        client1.on("game:action-rejected", (err) => {
            done(new Error(`Action rejected: ${JSON.stringify(err)}`));
        });

        client1.on("connect", () => {
            client1.emit("room:create", { displayName: "Driver Host" });
        });

        client1.on("room:state", (roomState) => {
            if (!roomCode && roomState.roomCode) {
                roomCode = roomState.roomCode;
                client1.emit("room:add-bot", { displayName: "Jarvis Bot" });
                return;
            }
            if (!botAdded && roomState.seats.length === 2) {
                botAdded = true;
                client1.emit("room:start");
            }
        });

        client1.on("game:event", (event) => {
            if (event.playerId && String(event.playerId).startsWith("bot:")) {
                sawBotEvent = true;
            }
        });

        client1.on("game:state", (state) => {
            if (!state || !state.currentTurnPlayerId) return;

            // Bot action cards can legitimately park a charge on the human.
            // Exercise the same projected PaymentModal settlement path rather
            // than treating the suspended bot turn as a socket-test timeout.
            if (state.pendingResolution && state.seq !== settledPendingSeq) {
                settledPendingSeq = state.seq;
                const paymentCardIds = [
                    ...(state.self.bank || []).map(card => card.id),
                    ...Object.values(state.self.properties || {}).flatMap(group => (group && group.cards) || []).map(card => card.id)
                ];
                client1.emit("game:action", { type: "PAY_RENT", paymentCardIds });
                return;
            }

            // As soon as it's the human's turn, end it immediately so the driver
            // hands the turn to the bot and we can observe the bot playing.
            if (state.currentTurnPlayerId === client1.id && !humanTurnEnded) {
                humanTurnEnded = true;
                client1.emit("game:action", { type: "END_TURN" });
                return;
            }

            // Control returned to the human after the bot's turn ran to completion.
            if (humanTurnEnded && state.currentTurnPlayerId === client1.id) {
                expect(sawBotEvent).to.equal(true);
                done();
            }
        });
    });
});
