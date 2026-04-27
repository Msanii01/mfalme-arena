'use strict';

const db = require('../db/client');
const { getIO } = require('../socket');

/**
 * Cleanup service to remove stale data.
 * Specifically handles the requirement: "when a game challenge is not done within 1 minute 
 * the challenge is erased completely (terminated)".
 * 
 * This affects both League of Legends and Tic-Tac-Toe challenges in the 'pending' state.
 * Since tictactoe_games uses ON DELETE CASCADE on match_id, linked games are also removed.
 */
const startCleanupService = () => {
  console.log('🧹 Cleanup service started (1 minute challenge timeout)');

  // Run every 30 seconds to be precise enough for a 1-minute timeout
  setInterval(async () => {
    try {
      // Find matches that are still pending and older than 1 minute
      const expiredMatches = await db.query(
        `SELECT match_id FROM matches 
         WHERE status = 'pending' 
         AND created_at < NOW() - INTERVAL '1 minute'`
      );

      if (expiredMatches.rows.length > 0) {
        const ids = expiredMatches.rows.map(m => m.match_id);
        console.log(`🧹 Cleaning up ${ids.length} expired challenges: ${ids.join(', ')}`);

        // Delete the matches. 
        // Note: tictactoe_games has ON DELETE CASCADE on match_id, so they will be removed too.
        await db.query(
          `DELETE FROM matches WHERE match_id = ANY($1)`,
          [ids]
        );

        // Optionally notify connected clients via socket that challenges were removed
        const io = getIO();
        if (io) {
          io.emit('challenges_cleaned', { match_ids: ids });
        }
      }
    } catch (error) {
      console.error('❌ Error in cleanup service:', error);
    }
  }, 30000); // Check every 30 seconds
};

module.exports = { startCleanupService };
