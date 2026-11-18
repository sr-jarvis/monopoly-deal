'use strict';
const crypto = require('crypto');
const sessions = new Map();
const TTL = 24 * 60 * 60 * 1000;
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
function acquire(token, fallbackPlayerId) {
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expires < now) sessions.delete(key);
    if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
        const session = sessions.get(digest(token));
        if (session) { session.expires = now + TTL; return { token, session }; }
    }
    if (sessions.size >= 1000) throw new Error('Session capacity reached');
    const nextToken = crypto.randomBytes(32).toString('hex');
    const session = { playerId: fallbackPlayerId, roomCode: null, socketId: null, expires: now + TTL };
    sessions.set(digest(nextToken), session);
    return { token: nextToken, session };
}
module.exports = { acquire };
