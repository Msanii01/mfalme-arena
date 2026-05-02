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
 *
 * Race-safety:
 *   - We never reap a row whose effective timestamp (accepted_at if set,
 *     else created_at) is within the last 90 seconds. That gives the
 *     accepter a window to finish on-chain deposits before cleanup runs.
 *   - The DELETE re-applies the same predicate so we don't delete a row
 *     that flipped to 'active' (or had accepted_at refreshed) between the
 *     SELECT and the DELETE.
 */

// Grace window: rows newer than this are off-limits.
const GRACE_INTERVAL_SQL = "INTERVAL '90 seconds'";

const startCleanupService = () => {
  console.log('🧹 Cleanup service started (90s grace window)');

  // Run every 30 seconds to be precise enough for a ~1-minute timeout
  setInterval(async () => {
    try {
      // Reapable rows: still pending, OR accepted with no deposits at all,
      // AND last-touched (accepted_at if set, else created_at) older than
      // the grace window.
      const expiredMatches = await db.query(
        `SELECT match_id FROM matches
         WHERE (
                 status = 'pending'
                 OR (status = 'accepted' AND player_a_deposited = FALSE AND player_b_deposited = FALSE)
              )
           AND COALESCE(accepted_at, created_at) < NOW() - ${GRACE_INTERVAL_SQL}`
      );

      if (expiredMatches.rows.length === 0) return;

      const ids = expiredMatches.rows.map(m => m.match_id);

      // Re-apply the same predicate in the DELETE: if a row was touched
      // (accepted, deposited, activated) between SELECT and DELETE, leave
      // it alone.
      const deleted = await db.query(
        `DELETE FROM matches
          WHERE match_id = ANY($1)
            AND (
                  status = 'pending'
                  OR (status = 'accepted' AND player_a_deposited = FALSE AND player_b_deposited = FALSE)
                )
            AND COALESCE(accepted_at, created_at) < NOW() - ${GRACE_INTERVAL_SQL}
          RETURNING match_id`,
        [ids]
      );

      if (deleted.rows.length === 0) return;

      const deletedIds = deleted.rows.map(r => r.match_id);
      console.log(`🧹 Cleaned up ${deletedIds.length} expired challenges: ${deletedIds.join(', ')}`);

      // Note: tictactoe_games has ON DELETE CASCADE on match_id, so they will be removed too.

      const io = getIO();
      if (io) {
        io.emit('challenges_cleaned', { match_ids: deletedIds });
      }
    } catch (error) {
      console.error('❌ Error in cleanup service:', error);
    }
  }, 30000); // Check every 30 seconds
};

module.exports = { startCleanupService };
