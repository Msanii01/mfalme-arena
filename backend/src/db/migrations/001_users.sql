CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  user_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  privy_user_id     VARCHAR UNIQUE NOT NULL,
  wallet_address    VARCHAR UNIQUE NOT NULL,
  riot_game_name    VARCHAR,
  riot_tag_line     VARCHAR,
  riot_puuid        VARCHAR UNIQUE,
  usdc_balance      DECIMAL(18,6) DEFAULT 0,
  is_admin          BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_privy_user_id ON users(privy_user_id);
CREATE INDEX idx_users_riot_puuid    ON users(riot_puuid);
