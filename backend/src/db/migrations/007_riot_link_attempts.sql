-- Riot account ownership verification.
-- A user proves they own a Riot account by setting their profile icon to a
-- pseudorandom target_icon_id we choose. The /verify endpoint re-fetches the
-- live summoner profile via Riot's summoner-v4 endpoint and confirms the icon.

CREATE TABLE riot_link_attempts (
  attempt_id     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  privy_user_id  VARCHAR      NOT NULL,
  puuid          VARCHAR      NOT NULL,
  game_name      VARCHAR      NOT NULL,
  tag_line       VARCHAR      NOT NULL,
  platform       VARCHAR      NOT NULL,
  target_icon_id INTEGER      NOT NULL,
  status         VARCHAR      NOT NULL DEFAULT 'pending',
  expires_at     TIMESTAMP    NOT NULL,
  verified_at    TIMESTAMP,
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_riot_link_attempts_user    ON riot_link_attempts(privy_user_id);
CREATE INDEX idx_riot_link_attempts_status  ON riot_link_attempts(status, expires_at);
