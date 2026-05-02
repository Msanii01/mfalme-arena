'use strict';

const { PrivyClient } = require('@privy-io/node');

// Ensure we have the required keys
if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
  console.error('Missing PRIVY_APP_ID or PRIVY_APP_SECRET in environment');
}

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET
});


/**
 * Express middleware to enforce Privy authentication.
 * Verifies the JWT Bearer token from the Authorization header.
 * On success, sets `req.user` with `{ id: privy_user_id }`.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the JWT token with Privy
    const verifiedClaims = await privy.utils().auth().verifyAccessToken(token);
    
    // Attach the verified user ID to the request
    req.user = {
      id: verifiedClaims.userId || verifiedClaims.user_id // Handle both naming conventions just in case
    };
    
    next();
  } catch (error) {
    console.error('Privy authentication failed:', error.message);
    res.status(401).json({ error: `Auth failed: ${error.message}` });
  }
}

/**
 * Resolve the canonical Ethereum wallet address for a Privy user.
 * Prefers smart wallets (used for gasless flow) over embedded/external EOAs.
 * Throws if the user has no ethereum wallet linked.
 *
 * @param {string} privyUserId
 * @returns {Promise<string>} lowercase 0x address
 */
async function getCanonicalWallet(privyUserId) {
  const user = await privy.users._get(privyUserId);
  const accounts = (user && user.linked_accounts) || [];
  const ethAccounts = accounts.filter(a => a.chain_type === 'ethereum' && a.address);
  const smartWallet = ethAccounts.find(a => a.type === 'smart_wallet');
  const chosen = smartWallet || ethAccounts[0];
  if (!chosen) {
    const err = new Error('No Ethereum wallet linked to this Privy user');
    err.status = 400;
    throw err;
  }
  return chosen.address.toLowerCase();
}

module.exports = {
  requireAuth,
  privy,
  getCanonicalWallet,
};
