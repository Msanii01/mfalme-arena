-- 004_tictactoe.sql
-- Create tic tac toe games table

CREATE TABLE IF NOT EXISTS tictactoe_games (
  game_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(match_id) ON DELETE CASCADE,
  player_x_id UUID REFERENCES users(user_id) NOT NULL,
  player_o_id UUID REFERENCES users(user_id) NOT NULL,
  board VARCHAR(9) DEFAULT '---------', -- 9 chars: -, X, or O
  turn VARCHAR(1) DEFAULT 'X',         -- 'X' or 'O'
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'won_x', 'won_o', 'draw'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ensure only one type of wager is linked per game
ALTER TABLE tictactoe_games 
ADD CONSTRAINT chk_wager_link 
CHECK (
  (tournament_id IS NULL OR match_id IS NULL)
);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_tictactoe_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tictactoe_updated_at
    BEFORE UPDATE
    ON tictactoe_games
    FOR EACH ROW
EXECUTE FUNCTION update_tictactoe_updated_at();
