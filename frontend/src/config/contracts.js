// Centralized contract address & RPC configuration.
// All required env vars are validated once at module-load. If any are
// missing, we throw immediately so the app fails fast instead of silently
// falling back to stale hardcoded testnet addresses.

const REQUIRED_ENVS = [
  'VITE_USDC_ADDRESS',
  'VITE_ESCROW_CONTRACT_ADDRESS',
  'VITE_TOURNAMENT_CONTRACT_ADDRESS',
  'VITE_BUNDLER_RPC_URL',
];

const missing = REQUIRED_ENVS.filter((k) => !import.meta.env[k]);
if (missing.length > 0) {
  throw new Error(
    `[mfalme-arena] Missing required Vite env vars: ${missing.join(', ')}. ` +
      `Set them in .env (and Vercel) before building.`
  );
}

export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS;
export const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;
export const TOURNAMENT_POOL_ADDRESS = import.meta.env.VITE_TOURNAMENT_CONTRACT_ADDRESS;
export const BUNDLER_RPC_URL = import.meta.env.VITE_BUNDLER_RPC_URL;

export const CHAIN_ID = 84532; // Base Sepolia
export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
