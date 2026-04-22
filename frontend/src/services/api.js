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
  linkRiot: (gameName, tagLine, walletAddress) =>
    api.post('/auth/link-riot', { gameName, tagLine, walletAddress }).then((r) => r.data),
// ── Match endpoints ────────────────────────────────────────────
export const matchAPI = {
  getMatches: () => api.get('/matches').then((r) => r.data.matches),
  getMatch: (id) => api.get(`/matches/${id}`).then((r) => r.data.match),
  createMatch: (opponentGameName, opponentTagLine, stakeAmount) => 
    api.post('/matches', { opponentGameName, opponentTagLine, stakeAmount }).then((r) => r.data.match),
  acceptMatch: (id) => api.post(`/matches/${id}/accept`).then((r) => r.data.match),
  markDeposited: (id) => api.post(`/matches/${id}/deposit`).then((r) => r.data.match),
};

export default api;
