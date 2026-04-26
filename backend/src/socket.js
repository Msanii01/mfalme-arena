'use strict';

const { Server } = require('socket.io');

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

    io.on('connection', (socket) => {
      console.log('Client connected to socket:', socket.id);

      socket.on('join_game', (gameId) => {
        socket.join(gameId);
        console.log(`Socket ${socket.id} joined game room ${gameId}`);
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
