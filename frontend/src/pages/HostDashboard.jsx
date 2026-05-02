import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallets, useConnectWallet } from '@privy-io/react-auth';
import { encodeFunctionData, parseUnits, createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import Sidebar from '../components/Sidebar.jsx';
import { tournamentAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';
import {
  USDC_ADDRESS,
  TOURNAMENT_POOL_ADDRESS,
  BUNDLER_RPC_URL,
  CHAIN_ID,
  CHAIN_ID_HEX,
} from '../config/contracts.js';

const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], type: "function" }
];

const TOURNAMENT_ABI = [
  { inputs: [{ name: "tournamentId", type: "bytes32" }, { name: "prizePool", type: "uint256" }], name: "createTournament", outputs: [], type: "function" },
  { inputs: [{ name: "tournamentId", type: "bytes32" }], name: "fundTournament", outputs: [], type: "function" }
];

// Validate stake/prize-pool input: positive finite number, [1, 100000], <=6 decimals (USDC precision)
function validateUsdcAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Enter a valid number';
  if (n < 1) return 'Minimum is 1 USDC';
  if (n > 100000) return 'Maximum is 100,000 USDC';
  const str = String(raw).trim();
  const decIdx = str.indexOf('.');
  if (decIdx >= 0 && str.length - decIdx - 1 > 6) return 'USDC supports up to 6 decimal places';
  return null;
}

// Poll EIP-5792 wallet_getCallsStatus until CONFIRMED. Returns the receipts array.
async function waitForCallsConfirmed(provider, bundleId, { intervalMs = 2000, timeoutMs = 180000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await provider.request({
      method: 'wallet_getCallsStatus',
      params: [bundleId],
    });
    const status = result?.status;
    const isConfirmed =
      status === 'CONFIRMED' ||
      status === 'confirmed' ||
      status === 200 ||
      ((result?.receipts?.length > 0) && (status === undefined || status === null));
    if (isConfirmed && result?.receipts?.length > 0) return result;
    if (status === 'FAILED' || status === 'failed' || status >= 400) {
      throw new Error(`Bundle failed (status=${status})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for bundle confirmation');
}

const pendingTxKey = (tournamentId) => `mfalme_pending_tx_tournament_${tournamentId}`;

// M4: map raw RPC/wallet errors to a short user-friendly string.
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

export default function HostDashboard() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();

  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [prizePool, setPrizePool] = useState('10');
  const [prizePoolError, setPrizePoolError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = async () => {
    try {
      const data = await tournamentAPI.getTournaments();
      setTournaments(data);
    } catch (err) {
      // M3: keep prod logs minimal — no full axios error dump.
      console.error('fetchTournaments failed', err?.response?.status, err?.message);
    } finally {
      setLoading(false);
    }
  };

  // Find the connected external wallet (e.g. OKX, MetaMask)
  const externalWallet = wallets.find(w => w.walletClientType !== 'privy');

  // Immediately prompt to switch to Base Sepolia if connected to the wrong network.
  // M8: Depend on stable scalars (address + chainId) instead of the wallet
  // object identity, which Privy may rebuild on every render and cause this
  // effect to refire (and potentially loop the chain-switch prompt).
  const externalAddress = externalWallet?.address;
  const externalChainId = externalWallet?.chainId;
  useEffect(() => {
    if (externalWallet && externalChainId !== `eip155:${CHAIN_ID}`) {
      externalWallet.switchChain(CHAIN_ID).catch(err => {
        if (import.meta.env.DEV) {
          console.error('Failed to switch chain on connect:', err);
        } else {
          console.error('Failed to switch chain on connect:', err?.message);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalAddress, externalChainId]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!name || !prizePool) return;

    // H2: validate prize pool amount
    const validation = validateUsdcAmount(prizePool);
    if (validation) {
      setPrizePoolError(validation);
      return;
    }
    setPrizePoolError(null);

    const smartWallet = wallets.find((w) => w.walletClientType === 'smart_wallet');
    const wallet = smartWallet || wallets.find(w => w.walletClientType !== 'privy');

    if (!wallet) {
      setError('Please connect a wallet first.');
      return;
    }

    setProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Create tournament in backend
      const dbTourney = await tournamentAPI.createTournament(name, prizePool);
      const contractId = dbTourney.contract_tournament_id; // bytes32 hex
      const amountRaw = parseUnits(prizePool.toString(), 6);

      const provider = await wallet.getEthereumProvider();

      // Ensure network is Base Sepolia
      if (wallet.chainId !== `eip155:${CHAIN_ID}`) {
        await wallet.switchChain(CHAIN_ID);
      }

      // 1. Create tournament data
      const createData = encodeFunctionData({
        abi: TOURNAMENT_ABI,
        functionName: 'createTournament',
        args: [contractId, amountRaw]
      });

      // 2. Approve USDC data
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [TOURNAMENT_POOL_ADDRESS, amountRaw]
      });

      // 3. Fund tournament data
      const fundData = encodeFunctionData({
        abi: TOURNAMENT_ABI,
        functionName: 'fundTournament',
        args: [contractId]
      });

      if (import.meta.env.DEV) console.log('Initiating tournament creation & funding...');

      let settlementTxHash = null;

      if (wallet.walletClientType === 'smart_wallet') {
        if (import.meta.env.DEV) console.log('Sending batched UserOperation via Paymaster...');

        const sendCallsResult = await provider.request({
          method: 'wallet_sendCalls',
          params: [{
            version: '1',
            chainId: CHAIN_ID_HEX,
            from: wallet.address,
            calls: [
              { to: TOURNAMENT_POOL_ADDRESS, data: createData, value: '0x0' },
              { to: USDC_ADDRESS, data: approveData, value: '0x0' },
              { to: TOURNAMENT_POOL_ADDRESS, data: fundData, value: '0x0' }
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
          localStorage.setItem(pendingTxKey(dbTourney.tournament_id), JSON.stringify({
            tournamentId: dbTourney.tournament_id,
            bundleId,
            type: 'tournament-fund',
            timestamp: Date.now(),
          }));
        } catch (_) { /* localStorage may be unavailable */ }

        // Wait for the bundler to confirm
        const status = await waitForCallsConfirmed(provider, bundleId);
        // Extract the on-chain tx hash from the last receipt (the fundTournament call)
        const receipts = status.receipts || [];
        const lastReceipt = receipts[receipts.length - 1];
        settlementTxHash = lastReceipt?.transactionHash || lastReceipt?.txHash || null;
      } else {
        // Sequential fallback for EOAs (requires gas)
        const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

        if (import.meta.env.DEV) console.log('Sending sequential transactions (Standard Wallet)...');

        const createTx = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: wallet.address, to: TOURNAMENT_POOL_ADDRESS, data: createData }]
        });
        setSuccess('Creating tournament on-chain...');
        await publicClient.waitForTransactionReceipt({ hash: createTx });

        const approveTx = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: wallet.address, to: USDC_ADDRESS, data: approveData }]
        });
        setSuccess('Approving USDC...');
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        const fundTx = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: wallet.address, to: TOURNAMENT_POOL_ADDRESS, data: fundData }]
        });
        setSuccess('Funding tournament...');
        await publicClient.waitForTransactionReceipt({ hash: fundTx });
        settlementTxHash = fundTx;
      }

      // Update backend status (only after on-chain confirmation)
      await tournamentAPI.fundTournament(dbTourney.tournament_id, settlementTxHash || 'batch-completed');
      try { localStorage.removeItem(pendingTxKey(dbTourney.tournament_id)); } catch (_) { /* noop */ }

      setSuccess('Tournament successfully created and funded!');
      setName('');
      fetchTournaments();

    } catch (err) {
      // M3: full error only in dev.
      if (import.meta.env.DEV) {
        console.error('Tournament creation error:', err);
      } else {
        console.error('Tournament creation error:', err?.response?.status, err?.message);
      }
      // M4: prefer backend-provided message if present, else map RPC errors.
      const apiMsg = err?.response?.data?.error;
      setError(apiMsg || formatTxError(err));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content" style={{ animation: 'fadeIn 0.3s ease-out' }}>
        <div className="page-header">
          <h1 className="page-title">🛡️ Host Dashboard</h1>
          <p className="page-subtitle">Manage Tournaments and Prize Pools</p>
        </div>

        <div className="grid-2">
          {/* Generation Form */}
          <div className="card card-purple">
            <h2 className="heading" style={{ marginBottom: 24 }}>Generate Tournament</h2>

            {!externalWallet ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ marginBottom: 16 }}>You must connect your host wallet to fund prize pools.</p>
                <button className="btn btn-primary" onClick={connectWallet}>
                  Connect Host Wallet (OKX/MetaMask)
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: 24, fontSize: 13, background: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8 }}>
                <strong>Host Wallet Connected:</strong> <br/>
                <span className="text-muted">{externalWallet.address}</span>
              </div>
            )}

            {error && (
              <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                <span>⚠️</span> {error}
              </div>
            )}

            {success && (
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                <span>✅</span> {success}
              </div>
            )}

            <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="form-group">
                <label className="form-label">Tournament Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Weekend Clash #1"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Prize Pool (USDC)</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max="100000"
                  step="0.000001"
                  value={prizePool}
                  onChange={(e) => {
                    setPrizePool(e.target.value);
                    setPrizePoolError(validateUsdcAmount(e.target.value));
                  }}
                  required
                />
                {prizePoolError && (
                  <p className="form-hint" style={{ color: 'var(--danger)' }}>{prizePoolError}</p>
                )}
              </div>

              <button
                type="submit"
                className={`btn btn-primary btn-full${processing ? ' btn-loading' : ''}`}
                disabled={processing || !name || !prizePool || !externalWallet || !!prizePoolError}
              >
                {processing ? 'Processing txs...' : 'Create & Fund Tournament 🏆'}
              </button>
            </form>
          </div>

          {/* Active Tournaments List */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 className="heading">Tournament Registry</h2>
              <button className="btn btn-ghost btn-sm" onClick={fetchTournaments}>Refresh</button>
            </div>

            {loading ? (
              <div className="text-center text-muted" style={{ padding: 40 }}>Loading...</div>
            ) : tournaments.length === 0 ? (
              <div className="empty-state" style={{ padding: '60px 20px' }}>
                <div className="empty-state-icon">🏆</div>
                <div className="empty-state-title">No tournaments yet</div>
                <p style={{ marginBottom: 16 }}>
                  Create your first tournament to fund a prize pool for the community.
                </p>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    // Focus the name input in the create form to invite action.
                    const nameInput = document.querySelector('input.form-input');
                    if (nameInput) nameInput.focus();
                  }}
                  disabled={!externalWallet}
                >
                  {externalWallet ? 'Create Tournament' : 'Connect Host Wallet First'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {tournaments.map(t => (
                  <div key={t.tournament_id} style={{
                    background: 'var(--bg-input)', padding: 16, borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <strong style={{ fontSize: 16 }}>{t.name}</strong>
                      <span className={`badge ${t.status === 'open' ? 'badge-teal' : 'badge-neutral'}`}>
                        {t.status.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)' }}>
                      <span>Prize: <span className="text-gold" style={{ fontWeight: 600 }}>{t.prize_pool} USDC</span></span>
                      <span>Players: {(t.player_a_id ? 1 : 0) + (t.player_b_id ? 1 : 0)} / 2</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
