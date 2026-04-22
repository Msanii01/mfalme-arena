CREATE TYPE match_status AS ENUM (
  'pending', 'accepted', 'active', 'completed', 'cancelled'
);

CREATE TABLE matches (
  match_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_a_id       UUID REFERENCES users(user_id) NOT NULL,
  player_b_id       UUID REFERENCES users(user_id),
  player_a_puuid    VARCHAR NOT NULL,
  player_b_puuid    VARCHAR,
  stake_amount      DECIMAL(18,6) NOT NULL,
  status            match_status DEFAULT 'pending',
  tournament_code   VARCHAR,
  riot_match_id     VARCHAR,
  winner_id         UUID REFERENCES users(user_id),
  winner_puuid      VARCHAR,
  escrow_match_id   BYTEA,
  settlement_tx     VARCHAR,
  created_at        TIMESTAMP DEFAULT NOW(),
  completed_at      TIMESTAMP
);

CREATE INDEX idx_matches_player_a ON matches(player_a_id);
CREATE INDEX idx_matches_player_b ON matches(player_b_id);
CREATE INDEX idx_matches_status   ON matches(status);
