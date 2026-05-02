'use strict';

const axios = require('axios');
const https = require('https');

const RIOT_API_KEY = process.env.RIOT_API_KEY;
// Regional cluster (americas / asia / europe) for account-v1 endpoint.
const REGION_CLUSTER = process.env.RIOT_REGION_CLUSTER || 'americas';

// Platform routes for summoner-v4 ("which shard does this account live on?").
// Anything outside this set is rejected to keep the surface tight.
const SUPPORTED_PLATFORMS = new Set([
  'na1', 'br1', 'la1', 'la2',     // Americas
  'euw1', 'eun1', 'tr1', 'ru',    // Europe
  'kr', 'jp1',                    // Asia
  'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2' // SEA
]);

const accountApi = axios.create({
  baseURL: `https://${REGION_CLUSTER}.api.riotgames.com`,
  headers: { 'X-Riot-Token': RIOT_API_KEY },
  httpsAgent: new https.Agent({ family: 4 })
});

function platformApi(platform) {
  return axios.create({
    baseURL: `https://${platform}.api.riotgames.com`,
    headers: { 'X-Riot-Token': RIOT_API_KEY },
    httpsAgent: new https.Agent({ family: 4 })
  });
}

function wrapRiotError(error, prefix) {
  if (error.response && error.response.status === 404) {
    const e = new Error(`${prefix} not found`);
    e.status = 404;
    return e;
  }
  if (error.response && error.response.status === 429) {
    const e = new Error('Riot API rate limited — please try again in a moment');
    e.status = 429;
    return e;
  }
  if (error.response && error.response.status === 403) {
    const e = new Error('Riot API access denied — check region and API key configuration');
    e.status = 403;
    return e;
  }
  const e = new Error('Failed to reach Riot API');
  e.status = (error.response && error.response.status) || 502;
  return e;
}

/**
 * Resolves Riot ID (gameName#tagLine) to a permanent PUUID.
 */
async function getAccountByRiotId(gameName, tagLine) {
  if (!RIOT_API_KEY) throw new Error('RIOT_API_KEY is not configured');
  try {
    const res = await accountApi.get(
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );
    return res.data; // { puuid, gameName, tagLine }
  } catch (error) {
    throw wrapRiotError(error, `Riot account ${gameName}#${tagLine}`);
  }
}

/**
 * Fetches summoner profile (level, profileIconId, ...) for a PUUID on a given platform.
 *
 * @param {string} puuid
 * @param {string} platform - na1, euw1, kr, etc.
 * @returns {Promise<{ id, accountId, puuid, profileIconId, revisionDate, summonerLevel }>}
 */
async function getSummonerByPuuid(puuid, platform) {
  if (!RIOT_API_KEY) throw new Error('RIOT_API_KEY is not configured');
  const lower = String(platform || '').toLowerCase();
  if (!SUPPORTED_PLATFORMS.has(lower)) {
    const e = new Error(`Unsupported platform: ${platform}`);
    e.status = 400;
    throw e;
  }
  try {
    const res = await platformApi(lower).get(`/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`);
    return res.data;
  } catch (error) {
    throw wrapRiotError(error, `Summoner ${puuid} on ${platform}`);
  }
}

module.exports = {
  getAccountByRiotId,
  getSummonerByPuuid,
  SUPPORTED_PLATFORMS,
};
