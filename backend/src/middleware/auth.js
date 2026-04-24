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
    const verifiedClaims = await privy.verifyAuthToken(token);
    
    // Attach the verified user ID to the request
    req.user = {
      id: verifiedClaims.userId
    };
    
    next();
  } catch (error) {
    console.error('Privy authentication failed:', error.message);
    res.status(401).json({ error: 'Auth failed: ' + error.message });
  }
}

module.exports = {
  requireAuth,
  privy // Export the client in case we need it elsewhere (e.g. fetching user data)
};
