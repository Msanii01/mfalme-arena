-- 006_match_accepted_at.sql
-- Track when a match was accepted by player B. Used by the cleanup service
-- to give the accepter a grace window to finish depositing before the row
-- is reaped as a stale challenge. Without this, cleanup can race with the
-- accept→deposit flow and delete a row mid-deposit.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
