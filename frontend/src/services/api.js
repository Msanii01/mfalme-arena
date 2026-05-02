import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the Privy auth token to every request.
// The token getter is injected at app startup via setTokenGetter().
let _getToken = null;
export function setTokenGetter(fn) {
  _getToken = fn;
}

api.interceptors.request.use(async (config) => {
  if (_getToken) {
    try {
      const token = await _getToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
    } catch (e) {
      // No token available — request proceeds unauthenticated
    }
  }
  return config;
});

// ── Auth endpoints ───────────────────────────────────────────
export const authAPI = {
  getMe: () => api.get('/auth/me').then((r) => r.data.user),
  syncUser: () => api.post('/auth/sync', {}).then((r) => r.data.user),

  // Riot ownership-verification flow:
  //   1) startRiotLink(...) → returns { attemptId, targetIconId, ... }
  //   2) UI tells the user to set their profile icon to targetIconId in-game.
  //   3) verifyRiotLink(attemptId) → re-checks the icon and finalizes the link.
  startRiotLink: (gameName, tagLine, platform, token) =>
    api.post(
      '/auth/link-riot/start',
      { gameName, tagLine, platform },
      token ? { headers: { Authorization: `Bearer ${token}` } } : {}
    ).then((r) => r.data),

  verifyRiotLink: (attemptId, token) =>
    api.post(
      '/auth/link-riot/verify',
      { attemptId },
      token ? { headers: { Authorization: `Bearer ${token}` } } : {}
    ).then((r) => r.data),
};
// ── Match endpoints ────────────────────────────────────────────
export const matchAPI = {
  getMatches: () => api.get('/matches').then((r) => r.data.matches),
  getMatch: (id) => api.get(`/matches/${id}`).then((r) => r.data.match),
  createMatch: (opponentGameName, opponentTagLine, opponentWallet, stakeAmount, gameMode) =>
    api.post('/matches', { opponentGameName, opponentTagLine, opponentWallet, stakeAmount, gameMode }).then((r) => r.data.match),
  acceptMatch: (id) => api.post(`/matches/${id}/accept`).then((r) => r.data.match),
  markDeposited: (id) => api.post(`/matches/${id}/deposit`).then((r) => r.data.match),
};

// ── Tournament endpoints ───────────────────────────────────────
export const tournamentAPI = {
  getTournaments: () => api.get('/tournaments').then((r) => r.data.tournaments),
  createTournament: (name, prizePool) =>
    api.post('/tournaments', { name, prizePool }).then((r) => r.data.tournament),
  fundTournament: (id, txHash) => api.post(`/tournaments/${id}/fund`, { txHash }).then((r) => r.data.tournament),
  registerTournament: (id) => api.post(`/tournaments/${id}/register`).then((r) => r.data.tournament),
};

// ── Tic Tac Toe endpoints ──────────────────────────────────────
export const tictactoeAPI = {
  getGame: (id) => api.get(`/tictactoe/${id}`).then((r) => r.data.game),
  initGame: (tournamentId, matchId) => api.post('/tictactoe/init', { tournamentId, matchId }).then((r) => r.data.game),
  makeMove: (id, index) => api.post(`/tictactoe/${id}/move`, { index }).then((r) => r.data.game),

};

// ── Stats endpoints ────────────────────────────────────────────
export const statsAPI = {
  getMyStats: () => api.get('/stats/me').then((r) => r.data.stats),
};

export default api;
