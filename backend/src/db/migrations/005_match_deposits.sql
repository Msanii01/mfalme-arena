-- 005_match_deposits.sql
-- Add deposit tracking columns to matches table

ALTER TABLE matches
ADD COLUMN player_a_deposited BOOLEAN DEFAULT FALSE,
ADD COLUMN player_b_deposited BOOLEAN DEFAULT FALSE;
