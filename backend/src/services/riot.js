'use strict';

const axios = require('axios');
const https = require('https');

const RIOT_API_KEY = process.env.RIOT_API_KEY;
// For Americas accounts (e.g. NA, BR, LAN, LAS), the cluster is americas.
const REGION_CLUSTER = process.env.RIOT_REGION_CLUSTER || 'americas';

const api = axios.create({
  baseURL: `https://${REGION_CLUSTER}.api.riotgames.com`,
  headers: {
    'X-Riot-Token': RIOT_API_KEY
  },
  httpsAgent: new https.Agent({ family: 4 })
});

/**
 * Fetches a Riot Account by Game Name and Tag Line.
 * Converts 'Faker#KR1' into a permanent PUUID.
 * 
 * @param {string} gameName - The in-game name (e.g., 'Faker')
 * @param {string} tagLine - The tag line without the hash (e.g., 'KR1')
 * @returns {Promise<{ puuid: string, gameName: string, tagLine: string }>}
 */
async function getAccountByRiotId(gameName, tagLine) {
  if (!RIOT_API_KEY) {
    throw new Error('RIOT_API_KEY is not configured');
  }

  try {
    // API Path: /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
    const response = await api.get(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
    return response.data; // { puuid, gameName, tagLine }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      const notFoundErr = new Error(`Riot account ${gameName}#${tagLine} not found`);
      notFoundErr.status = 404;
      throw notFoundErr;
    }
    console.error('Riot API error:', error.response ? error.response.data : error.message);
    const err = new Error('Failed to fetch Riot account');
    err.status = error.response ? error.response.status : 500;
    throw err;
  }
}

module.exports = {
  getAccountByRiotId
};
