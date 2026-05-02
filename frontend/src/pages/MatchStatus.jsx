import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { encodeFunctionData, parseUnits, createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import Sidebar from '../components/Sidebar.jsx';
import { matchAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';
import {
  USDC_ADDRESS,
  ESCROW_ADDRESS,
  BUNDLER_RPC_URL,
  CHAIN_ID,
  CHAIN_ID_HEX,
} from '../config/contracts.js';

const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], type: "function" }
];

const ESCROW_ABI = [
  { inputs: [{ name: "matchId", type: "bytes32" }, { name: "player", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], type: "function" }
];

const pendingTxKey = (matchId) => `mfalme_pending_tx_${matchId}`;

// M4: Map raw RPC/wallet errors to a short user-friendly string. Keep raw
// details in dev console only.
function formatTxError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('user rejected') || msg.includes('user denied')) {
    return 'Transaction cancelled';
  }
  if (msg.includes('insufficient funds')) {
    return 'Insufficient ETH for gas (or USDC for stake)';
  }
  if (msg.includes('paymaster')) {
    return 'Sponsorship unavailable, please try again';
  }
  return 'Transaction failed. Please try again.';
}

// Poll EIP-5792 wallet_getCallsStatus until CONFIRMED. Returns the receipts.
async function waitForCallsConfirmed(provider, bundleId, { intervalMs = 2000, timeoutMs = 180000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await provider.request({
      method: 'wallet_getCallsStatus',
      params: [bundleId],
    });
    // EIP-5792 status: "PENDING" | "CONFIRMED" — some wallets use numeric codes (1 pending, 200 confirmed)
    const status = result?.status;
    const isConfirmed =
      status === 'CONFIRMED' ||
      status === 'confirmed' ||
      status === 200 ||
      ((result?.receipts?.length > 0) && (status === undefined || status === null));
    if (isConfirmed && result?.receipts?.length > 0) {
      return result;
    }
    if (status === 'FAILED' || status === 'failed' || status >= 400) {
      throw new Error(`Bundle failed (status=${status})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for bundle confirmation');
}

export default function MatchStatus() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [depositing, setDepositing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);
  const unmountedRef = useRef(false);
  const intervalRef = useRef(null);

  // Poll every 5s until either the component unmounts or match.status === 'completed'.
  useEffect(() => {
    unmountedRef.current = false;
    fetchMatch();
    intervalRef.current = setInterval(() => {
      if (unmountedRef.current) return;
      fetchMatch();
    }, 5000);
    return () => {
      unmountedRef.current = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Stop polling once the match is settled.
  useEffect(() => {
    if (match?.status === 'completed' && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [match?.status]);

  // On mount, see if there's a persisted pending UserOp for this match and resume polling.
  useEffect(() => {
    const raw = localStorage.getItem(pendingTxKey(id));
    if (!raw) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { localStorage.removeItem(pendingTxKey(id)); return; }
    if (!parsed?.bundleId) { localStorage.removeItem(pendingTxKey(id)); return; }

    (async () => {
      try {
        const smartWallet = wallets.find((w) => w.walletClientType === 'smart_wallet');
        const wallet = smartWallet || wallets[0];
        if (!wallet) return;
        const provider = await wallet.getEthereumProvider();
        await waitForCallsConfirmed(provider, parsed.bundleId);
        await matchAPI.markDeposited(id);
        localStorage.removeItem(pendingTxKey(id));
        if (!unmountedRef.current) fetchMatch();
      } catch (err) {
        // M3: don't dump full error objects in prod (may include URLs / addresses).
        if (import.meta.env.DEV) {
          console.error('Resumed bundle polling failed:', err);
        } else {
          console.error('Resumed bundle polling failed:', err?.message);
        }
        // Leave the entry so a subsequent reload can try again or be cleared by user action.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, wallets.length]);

  const fetchMatch = async () => {
    try {
      const data = await matchAPI.getMatch(id);
      if (unmountedRef.current) return;
      setMatch(data);
    } catch (err) {
      // M3: don't log full axios error in prod.
      console.error('fetchMatch failed', err?.response?.status, err?.message);
      if (unmountedRef.current) return;
      if (err.response?.status === 404) navigate('/challenge', { replace: true });
    } finally {
      if (!unmountedRef.current) setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await matchAPI.acceptMatch(id);
      fetchMatch();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept match');
    } finally {
      setAccepting(false);
    }
  };

  const handleDeposit = async () => {
    if (!authenticated) {
      setError('Reconnect to continue');
      return;
    }

    // Specifically look for the Smart Wallet to enable gas sponsorship
    const smartWallet = wallets.find((w) => w.walletClientType === 'smart_wallet');
    const wallet = smartWallet || wallets[0];

    if (!wallet) {
      setError('No wallet connected. Please log in.');
      return;
    }

    setDepositing(true);
    setError(null);

    try {
      const amountRaw = parseUnits(match.stake_amount.toString(), 6);
      const provider = await wallet.getEthereumProvider();

      // Ensure network is Base Sepolia (mirrors HostDashboard)
      if (wallet.chainId !== `eip155:${CHAIN_ID}`) {
        await wallet.switchChain(CHAIN_ID);
      }

      // 1. Approve USDC
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [ESCROW_ADDRESS, amountRaw]
      });

      // 2. Deposit into Escrow
      const depositData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: 'deposit',
        args: [match.escrow_match_id, wallet.address, amountRaw]
      });

      if (import.meta.env.DEV) console.log('Initiating deposit...');

      // Re-check auth right before signing
      if (!authenticated) {
        setError('Reconnect to continue');
        setDepositing(false);
        return;
      }

      // If using Smart Wallet, batch into a single sponsored UserOperation
      if (wallet.walletClientType === 'smart_wallet') {
        if (import.meta.env.DEV) console.log('Sending batched UserOperation via Paymaster...');

        const sendCallsResult = await provider.request({
          method: 'wallet_sendCalls',
          params: [{
            version: '1',
            chainId: CHAIN_ID_HEX,
            from: wallet.address,
            calls: [
              { to: USDC_ADDRESS, data: approveData, value: '0x0' },
              { to: ESCROW_ADDRESS, data: depositData, value: '0x0' }
            ],
            capabilities: {
              paymasterService: { url: BUNDLER_RPC_URL }
            }
          }]
        });
        // EIP-5792 wallets vary: some return a string, others return { id: ... }
        const bundleId = typeof sendCallsResult === 'string' ? sendCallsResult : sendCallsResult?.id;
        if (!bundleId) throw new Error('wallet_sendCalls returned no bundle id');

        // Persist pending tx so we can resume polling across reloads
        try {
          localStorage.setItem(pendingTxKey(id), JSON.stringify({
            matchId: id,
            bundleId,
            type: 'deposit',
            timestamp: Date.now(),
          }));
        } catch (_) { /* localStorage may be unavailable */ }

        // Poll until the bundler confirms the UserOp
        await waitForCallsConfirmed(provider, bundleId);
      } else {
        // Fallback for standard wallets (requires gas) — wait for each receipt.
        if (import.meta.env.DEV) console.log('Sending sequential transactions (Standard Wallet)...');
        const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

        const approveTx = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: wallet.address, to: USDC_ADDRESS, data: approveData }]
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        const depositTx = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: wallet.address, to: ESCROW_ADDRESS, data: depositData }]
        });
        await publicClient.waitForTransactionReceipt({ hash: depositTx });
      }

      // Mark as deposited on backend (only after on-chain confirmation)
      await matchAPI.markDeposited(id);
      try { localStorage.removeItem(pendingTxKey(id)); } catch (_) { /* noop */ }
      fetchMatch();

    } catch (err) {
      // M3: only dump the full error in dev; in prod log just the message.
      if (import.meta.env.DEV) {
        console.error('Deposit error:', err);
      } else {
        console.error('Deposit error:', err?.message);
      }
      // M4: map common RPC error messages to a user-friendly string.
      setError(formatTxError(err));
    } finally {
      setDepositing(false);
    }
  };

  if (loading) return <div className="loading-screen"><div className="loading-crown">👑</div><p className="loading-text">Loading match...</p></div>;
  if (!match) return null;

  const isCreator = user?.user_id === match.player_a_id;
  const isOpponent = user?.user_id === match.player_b_id;

  const getStatusBadge = () => {
    switch(match.status) {
      case 'pending': return <span className="badge badge-neutral">PENDING</span>;
      case 'accepted': return <span className="badge badge-purple badge-dot badge-dot-pulse">AWAITING DEPOSITS</span>;
      case 'active': return <span className="badge badge-teal badge-dot badge-dot-pulse">MATCH ACTIVE</span>;
      case 'completed': return <span className="badge badge-gold">COMPLETED</span>;
      default: return <span className="badge badge-neutral">{match.status.toUpperCase()}</span>;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content" style={{ animation: 'fadeIn 0.3s ease-out' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/challenge')}>← Back to Lobby</button>
          {getStatusBadge()}
        </div>

        <div className="card" style={{ maxWidth: 800, margin: '0 auto', padding: 40 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div className="subheading" style={{ marginBottom: 8 }}>Match #{match.match_id.slice(0, 8)}</div>
            <div className="text-gold display-md" style={{ marginBottom: 8 }}>{match.stake_amount} USDC</div>
            <p className="text-muted">Winner Takes All</p>
          </div>

          <div className="grid-2" style={{ gap: 40, alignItems: 'center', textAlign: 'center' }}>
            {/* Player A */}
            <div className="card card-purple">
              <div className="user-avatar" style={{ width: 80, height: 80, fontSize: 32, margin: '0 auto 16px' }}>
                {match.game_mode === 'tictactoe' ? 'P1' : (match.player_a_name?.[0]?.toUpperCase() ?? '?')}
              </div>
              <h3 className="heading">
                {match.game_mode === 'tictactoe'
                  ? (match.player_a_wallet
                      ? `${match.player_a_wallet.slice(0, 6)}...${match.player_a_wallet.slice(-4)}`
                      : 'Unknown')
                  : `${match.player_a_name ?? '?'}#${match.player_a_tag ?? '?'}`}
              </h3>
              <p className="text-muted mt-2">Challenger</p>
            </div>

            {/* Player B */}
            <div className="card card-gold">
              <div className="user-avatar" style={{ width: 80, height: 80, fontSize: 32, margin: '0 auto 16px', background: 'var(--gradient-gold)' }}>
                {match.game_mode === 'tictactoe' ? 'P2' : (match.player_b_name?.[0]?.toUpperCase() ?? '?')}
              </div>
              <h3 className="heading">
                {match.game_mode === 'tictactoe'
                  ? (match.player_b_wallet
                      ? `${match.player_b_wallet.slice(0, 6)}...${match.player_b_wallet.slice(-4)}`
                      : 'Unknown')
                  : `${match.player_b_name ?? '?'}#${match.player_b_tag ?? '?'}`}
              </h3>
              <p className="text-muted mt-2">Opponent</p>
            </div>
          </div>

          {error && (
            <div className="alert alert-danger" style={{ marginTop: 32 }}>
              <span>⚠️</span> {error}
            </div>
          )}

          {/* Action Area */}
          <div style={{ marginTop: 40, padding: 32, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
            {match.status === 'pending' && isOpponent && (
              <div>
                <p style={{ marginBottom: 20 }}>You have been challenged. Accept to proceed to the escrow phase.</p>
                <button
                  className={`btn btn-primary btn-lg${accepting ? ' btn-loading' : ''}`}
                  onClick={handleAccept}
                  disabled={accepting}
                >
                  {accepting ? 'Accepting…' : 'Accept Challenge'}
                </button>
              </div>
            )}

            {match.status === 'pending' && isCreator && (
              <p className="text-muted">Waiting for opponent to accept...</p>
            )}

            {match.status === 'accepted' && (
              <div>
                <p style={{ marginBottom: 20 }}>Match accepted. Both players must deposit their USDC stake into the smart contract.</p>

                {((isCreator && match.player_a_deposited) || (isOpponent && match.player_b_deposited)) ? (
                  <div className="alert alert-info">
                    <span>⏳</span> Waiting for opponent to deposit...
                  </div>
                ) : (
                  <>
                    <button
                      className={`btn btn-primary btn-lg${depositing ? ' btn-loading' : ''}`}
                      onClick={handleDeposit}
                      disabled={depositing}
                    >
                      {depositing ? 'Processing via Paymaster...' : 'Deposit USDC (Gasless)'}
                    </button>
                    <p className="caption mt-4">Gas fees are sponsored by Mfalme Arena</p>
                  </>
                )}
              </div>
            )}

            {match.status === 'active' && (
              <div>
                <div style={{ fontSize: 40, marginBottom: 16 }}>⚔️</div>
                <h3 className="heading mb-2">Match is Live!</h3>
                {match.game_mode === 'tictactoe' ? (
                  <>
                    <p className="text-muted" style={{ marginBottom: 24 }}>Both players have deposited. The arena is ready.</p>
                    <button className="btn btn-primary btn-lg" onClick={() => navigate(`/tictactoe/${match.tictactoe_game_id}`)}>
                      Enter Tic-Tac-Toe Arena ⚔️
                    </button>
                  </>
                ) : (
                  <p className="text-muted">Start your League of Legends match now. The smart contract will automatically settle when Riot reports the result.</p>
                )}
              </div>
            )}

            {match.status === 'completed' && (
              <div>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🏆</div>
                <h3 className="text-gold display-md mb-2">{match.winner_id === user?.user_id ? 'You Won!' : 'Match Over'}</h3>
                <p className="text-muted">USDC has been transferred automatically.</p>
                <a href={`https://sepolia.basescan.org/tx/${match.settlement_tx}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm mt-4">
                  View Settlement on Basescan ↗
                </a>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
