'use strict';

const { Server } = require('socket.io');
const { privy } = require('./middleware/auth');
const db = require('./db/client');

let io;

module.exports = {
  init: (server) => {
    io = new Server(server, {
      cors: {
        origin: (origin, callback) => {
          const allowed = [
            'http://localhost:5173',
            'http://localhost:3000',
            process.env.FRONTEND_URL,
          ].filter(Boolean);
          if (!origin || allowed.includes(origin) || origin.endsWith('.vercel.app')) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        },
        credentials: true,
      }
    });

    // Auth middleware: every socket must present a valid Privy access token
    // in `socket.handshake.auth.token`. Anonymous sockets are rejected so they
    // can never subscribe to a `game_update` room.
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Missing auth token'));
        }
        const verifiedClaims = await privy.utils().auth().verifyAccessToken(token);
        const privyUserId = verifiedClaims.userId || verifiedClaims.user_id;
        if (!privyUserId) {
          return next(new Error('Invalid auth token'));
        }
        socket.data.userId = privyUserId;
        next();
      } catch (err) {
        console.error('Socket auth failed:', err.message);
        next(new Error('Auth failed'));
      }
    });

    io.on('connection', (socket) => {
      console.log('Client connected to socket:', socket.id, 'user:', socket.data.userId);

      // join_game enforces that the requesting user is one of the two players
      // (player_a/player_b) on the underlying match or tournament. Without
      // this, any authenticated user could subscribe to any game's room and
      // observe live moves / settlement events.
      socket.on('join_game', async (gameId) => {
        try {
          if (!gameId || typeof gameId !== 'string') {
            return; // Silently ignore malformed payloads
          }

          // Resolve internal user_id from the privy id stashed on the socket.
          const userRes = await db.query(
            'SELECT user_id FROM users WHERE privy_user_id = $1',
            [socket.data.userId]
          );
          if (userRes.rows.length === 0) {
            console.warn(`join_game denied: no user row for ${socket.data.userId}`);
            return;
          }
          const internalUserId = userRes.rows[0].user_id;

          // One DB call: pull the game's match + tournament linkage and the
          // associated player ids from whichever side actually exists.
          const result = await db.query(
            `SELECT
                COALESCE(m.player_a_id, t.player_a_id) AS player_a_id,
                COALESCE(m.player_b_id, t.player_b_id) AS player_b_id
             FROM tictactoe_games g
             LEFT JOIN matches m ON g.match_id = m.match_id
             LEFT JOIN tournaments t ON g.tournament_id = t.tournament_id
             WHERE g.game_id = $1`,
            [gameId]
          );

          if (result.rows.length === 0) {
            console.warn(`join_game denied: game ${gameId} not found`);
            return;
          }
          const { player_a_id, player_b_id } = result.rows[0];
          if (internalUserId !== player_a_id && internalUserId !== player_b_id) {
            console.warn(`join_game denied: user ${internalUserId} not a player in game ${gameId}`);
            return;
          }

          socket.join(gameId);
          console.log(`Socket ${socket.id} joined game room ${gameId}`);
        } catch (err) {
          console.error('join_game error:', err.message);
        }
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  }
};
