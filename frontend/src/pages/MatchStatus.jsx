import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { encodeFunctionData, parseUnits } from 'viem';
import Sidebar from '../components/Sidebar.jsx';
import { matchAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

// USDC on Base Sepolia
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || '0x8EcFA38a99e69950eEb54EEDAE12df4F4DEC713A';

const ERC20_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], type: "function" }
];

const ESCROW_ABI = [
  { inputs: [{ name: "matchId", type: "bytes32" }, { name: "player", type: "address" }, { name: "amount", type: "uint256" }], name: "deposit", outputs: [], type: "function" }
];

export default function MatchStatus() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { wallets } = useWallets();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [depositing, setDepositing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMatch();
    const interval = setInterval(fetchMatch, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const fetchMatch = async () => {
    try {
      const data = await matchAPI.getMatch(id);
      setMatch(data);
    } catch (err) {
      console.error(err);
      if (err.response?.status === 404) navigate('/challenge', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    try {
      await matchAPI.acceptMatch(id);
      fetchMatch();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept match');
    }
  };

  const handleDeposit = async () => {
    const wallet = wallets[0];
    if (!wallet) {
      setError('No wallet connected');
      return;
    }

    setDepositing(true);
    setError(null);

    try {
      const amountRaw = parseUnits(match.stake_amount.toString(), 6);

      // We attempt to send a batched UserOperation for gasless UX (Smart Wallets)
      // or sequential transactions if using standard EOA.
      // With Privy Smart Wallets (Account Abstraction), we can get an Ethereum provider.
      const provider = await wallet.getEthereumProvider();

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

      console.log('Sending transaction... Gas is sponsored by Account Abstraction.');
      
      // If the wallet supports EIP-5792 (batching) it will batch them gas-free.
      // Otherwise we prompt sequentially. For MVP, we just prompt sequentially.
      await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: wallet.address,
          to: USDC_ADDRESS,
          data: approveData
        }]
      });

      await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: wallet.address,
          to: ESCROW_ADDRESS,
          data: depositData
        }]
      });

      // Mark as deposited on backend
      await matchAPI.markDeposited(id);
      fetchMatch();
      
    } catch (err) {
      console.error(err);
      setError(err.message || 'Deposit failed');
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
                {match.game_mode === 'tictactoe' ? 'P1' : match.player_a_name[0].toUpperCase()}
              </div>
              <h3 className="heading">
                {match.game_mode === 'tictactoe' 
                  ? `${match.player_a_wallet.slice(0, 6)}...${match.player_a_wallet.slice(-4)}` 
                  : `${match.player_a_name}#${match.player_a_tag}`}
              </h3>
              <p className="text-muted mt-2">Challenger</p>
            </div>

            {/* Player B */}
            <div className="card card-gold">
              <div className="user-avatar" style={{ width: 80, height: 80, fontSize: 32, margin: '0 auto 16px', background: 'var(--gradient-gold)' }}>
                {match.game_mode === 'tictactoe' ? 'P2' : match.player_b_name[0].toUpperCase()}
              </div>
              <h3 className="heading">
                {match.game_mode === 'tictactoe' 
                  ? `${match.player_b_wallet.slice(0, 6)}...${match.player_b_wallet.slice(-4)}` 
                  : `${match.player_b_name}#${match.player_b_tag}`}
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
                <button className="btn btn-primary btn-lg" onClick={handleAccept}>Accept Challenge</button>
              </div>
            )}
            
            {match.status === 'pending' && isCreator && (
              <p className="text-muted">Waiting for opponent to accept...</p>
            )}

            {match.status === 'accepted' && (
              <div>
                <p style={{ marginBottom: 20 }}>Match accepted. Both players must deposit their USDC stake into the smart contract.</p>
                <button 
                  className={`btn btn-primary btn-lg${depositing ? ' btn-loading' : ''}`}
                  onClick={handleDeposit}
                  disabled={depositing}
                >
                  {depositing ? 'Processing via Paymaster...' : 'Deposit USDC (Gasless)'}
                </button>
                <p className="caption mt-4">Gas fees are sponsored by Mfalme Arena</p>
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
