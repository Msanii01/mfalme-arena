CREATE TYPE tournament_status AS ENUM (
  'created', 'funded', 'open', 'full', 'active', 'completed', 'cancelled'
);

CREATE TABLE tournaments (
  tournament_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by              UUID REFERENCES users(user_id) NOT NULL,
  name                    VARCHAR NOT NULL,
  prize_pool              DECIMAL(18,6) NOT NULL,
  status                  tournament_status DEFAULT 'created',
  player_a_id             UUID REFERENCES users(user_id),
  player_b_id             UUID REFERENCES users(user_id),
  player_a_puuid          VARCHAR,
  player_b_puuid          VARCHAR,
  tournament_code         VARCHAR,
  riot_match_id           VARCHAR,
  winner_id               UUID REFERENCES users(user_id),
  contract_tournament_id  BYTEA,
  fund_tx                 VARCHAR,
  settlement_tx           VARCHAR,
  created_at              TIMESTAMP DEFAULT NOW(),
  completed_at            TIMESTAMP
);

CREATE INDEX idx_tournaments_status     ON tournaments(status);
CREATE INDEX idx_tournaments_created_by ON tournaments(created_by);
