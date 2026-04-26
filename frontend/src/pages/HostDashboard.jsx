import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallets, useConnectWallet } from '@privy-io/react-auth';
import { encodeFunctionData, parseUnits, createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import Sidebar from '../components/Sidebar.jsx';
import { tournamentAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

// Base Sepolia Addresses
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const TOURNAMENT_POOL_ADDRESS = import.meta.env.VITE_TOURNAMENT_CONTRACT_ADDRESS || '0x81D9859248489e73ccF00845EF3Bc7E2B59FC9f8';

const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], type: "function" }
];

const TOURNAMENT_ABI = [
  { inputs: [{ name: "tournamentId", type: "bytes32" }, { name: "prizePool", type: "uint256" }], name: "createTournament", outputs: [], type: "function" },
  { inputs: [{ name: "tournamentId", type: "bytes32" }], name: "fundTournament", outputs: [], type: "function" }
];

export default function HostDashboard() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();

  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [prizePool, setPrizePool] = useState('10');
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
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Find the connected external wallet (e.g. OKX, MetaMask)
  const externalWallet = wallets.find(w => w.walletClientType !== 'privy');

  // Immediately prompt to switch to Base Sepolia if connected to the wrong network
  useEffect(() => {
    if (externalWallet && externalWallet.chainId !== 'eip155:84532') {
      externalWallet.switchChain(84532).catch(err => {
        console.error('Failed to switch chain on connect:', err);
      });
    }
  }, [externalWallet]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!name || !prizePool) return;
    if (!externalWallet) {
      setError('Please connect your admin wallet first.');
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

      const provider = await externalWallet.getEthereumProvider();
      const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

      // Ensure network is Base Sepolia right before execution just in case
      if (externalWallet.chainId !== 'eip155:84532') {
        await externalWallet.switchChain(84532);
      }

      // 2. Create tournament on-chain
      const createData = encodeFunctionData({
        abi: TOURNAMENT_ABI,
        functionName: 'createTournament',
        args: [contractId, amountRaw]
      });

      console.log('Sending createTournament tx...');
      const createTxHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: externalWallet.address, to: TOURNAMENT_POOL_ADDRESS, data: createData }]
      });
      setSuccess('Tournament created. Waiting for confirmation...');
      await publicClient.waitForTransactionReceipt({ hash: createTxHash });

      // 3. Approve USDC
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [TOURNAMENT_POOL_ADDRESS, amountRaw]
      });

      console.log('Sending USDC approve tx...');
      const approveTxHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: externalWallet.address, to: USDC_ADDRESS, data: approveData }]
      });
      setSuccess('USDC approved. Waiting for confirmation...');
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

      // 4. Fund tournament on-chain
      const fundData = encodeFunctionData({
        abi: TOURNAMENT_ABI,
        functionName: 'fundTournament',
        args: [contractId]
      });

      console.log('Sending fundTournament tx...');
      const fundTxHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: externalWallet.address, to: TOURNAMENT_POOL_ADDRESS, data: fundData }]
      });
      setSuccess('Funding sent. Waiting for confirmation...');
      await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

      // 5. Update backend status to Funded/Open
      await tournamentAPI.fundTournament(dbTourney.tournament_id, fundTxHash);
      
      setSuccess('Tournament successfully created and funded!');
      setName('');
      fetchTournaments();

    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || err.message || 'Failed to generate tournament');
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
                  step="0.1"
                  value={prizePool}
                  onChange={(e) => setPrizePool(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className={`btn btn-primary btn-full${processing ? ' btn-loading' : ''}`}
                disabled={processing || !name || !prizePool || !externalWallet}
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
              <div className="empty-state" style={{ padding: '40px 16px' }}>
                <div className="empty-state-title">No tournaments</div>
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
