const axios = require('axios');
const https = require('https');

async function testRiotApi() {
  console.log('Testing without httpsAgent...');
  try {
    const api1 = axios.create({ baseURL: 'https://americas.api.riotgames.com' });
    await api1.get('/riot/account/v1/accounts/by-riot-id/test/test');
  } catch (e) {
    console.log('Without agent error:', e.message);
  }

  console.log('\nTesting with httpsAgent (family: 4)...');
  try {
    const api2 = axios.create({
      baseURL: 'https://americas.api.riotgames.com',
      httpsAgent: new https.Agent({ family: 4 })
    });
    await api2.get('/riot/account/v1/accounts/by-riot-id/test/test');
  } catch (e) {
    console.log('With agent error:', e.message);
  }
}

testRiotApi();
