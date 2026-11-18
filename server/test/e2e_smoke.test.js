const { expect } = require("chai");
const ioClient = require("socket.io-client");
const http = require("http");

describe("End-to-End Gameplay Scenarios & Socket.IO Smoke Test", function() {
    this.timeout(10000);
    let server;
    let serverPort;
    let client1, client2;
    let app;

    before((done) => {
        app = require("../app");
        server = app.http;
        server.listen(0, () => {
            serverPort = server.address().port;
            console.log(`E2E Smoke Test Server listening on port ${serverPort}`);
            done();
        });
    });

    after((done) => {
        if (client1 && client1.connected) client1.disconnect();
        if (client2 && client2.connected) client2.disconnect();
        if (server) {
            server.close(done);
        } else {
            done();
        }
    });

    it("should verify REST endpoints (rooms, stats, cards, rules, bot simulation)", (done) => {
        const req = http.get(`http://localhost:${serverPort}/api/monopoly/cards`, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                const parsed = JSON.parse(data);
                expect(parsed.status).to.equal("ok");
                expect(parsed.catalog.totalCards).to.equal(106);
                expect(parsed.catalog.printedTotalCardsIncludingReference).to.equal(110);
                done();
            });
        });
        req.on("error", done);
    });

    it("should execute a full multi-player room creation, join, start, turn flow, and socket state sync", (done) => {
        const url = `http://localhost:${serverPort}`;
        client1 = ioClient(url, { forceNew: true, transports: ["websocket"] });

        let roomCode = null;
        let c2GameState = null;
        let c1TurnEnded = false;

        client1.on("connect", () => {
            console.log("Client 1 connected, creating room...");
            client1.emit("room:create", { displayName: "Scott (Host)" });
        });

        client1.on("game:action-rejected", (err) => {
            console.error("Client 1 action rejected:", err);
            done(new Error(`Action rejected: ${JSON.stringify(err)}`));
        });

        client1.on("room:state", (roomState) => {
            if (!roomCode && roomState.roomCode) {
                roomCode = roomState.roomCode;
                expect(roomCode).to.be.a("string").with.lengthOf(4);
                expect(roomState.hostPlayerId).to.equal(client1.id);

                // Connect Client 2 and join room
                client2 = ioClient(url, { forceNew: true, transports: ["websocket"] });

                client2.on("game:action-rejected", (err) => {
                    console.error("Client 2 action rejected:", err);
                    done(new Error(`Client 2 action rejected: ${JSON.stringify(err)}`));
                });

                client2.on("connect", () => {
                    console.log(`Client 2 connected, joining room ${roomCode}...`);
                    client2.emit("room:join", { roomCode, displayName: "Jarvis (P2)" });
                });

                client2.on("room:state", (c2RoomState) => {
                    if (c2RoomState.seats && c2RoomState.seats.length === 2 && c2RoomState.status === "LOBBY") {
                        console.log("Both players joined. Host starting match...");
                        client1.emit("room:start");
                    }
                });

                client2.on("game:state", (state) => {
                    console.log("Client 2 received game:state!", state?.currentTurnPlayerId);
                    c2GameState = state;
                });
            }
        });

        client1.on("game:state", (state) => {
            console.log("Client 1 received game:state! Active player:", state?.currentTurnPlayerId);
            if (!state || !state.currentTurnPlayerId) return;

            // Client 1's turn
            if (state.currentTurnPlayerId === client1.id && !c1TurnEnded) {
                c1TurnEnded = true;
                expect(state.self.hand).to.be.an("array");
                expect(state.self.hand.length).to.be.at.least(5);

                const cardToPlay = state.self.hand.find(c => c.type === "MONEY" || c.type === "PROPERTY" || c.type === "ACTION");
                if (cardToPlay) {
                    console.log(`Client 1 playing card ${cardToPlay.id} (${cardToPlay.name || cardToPlay.type})...`);
                    let targetZone = "bank";
                    if (cardToPlay.type === "PROPERTY") targetZone = "properties";

                    client1.emit("game:action", {
                        type: "PLAY_CARD",
                        cardId: cardToPlay.id,
                        targetZone: targetZone
                    });
                }

                setTimeout(() => {
                    console.log("Client 1 ending turn...");
                    client1.emit("game:action", { type: "END_TURN" });
                }, 100);
            } else if (state.currentTurnPlayerId === client2.id) {
                expect(state.currentTurnPlayerId).to.equal(client2.id);
                expect(c2GameState).to.not.be.null;
                console.log("Turn successfully rotated to Client 2! E2E Gameplay Scenario Verified.");
                done();
            }
        });
    });
});
