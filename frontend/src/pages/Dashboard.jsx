import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { createPublicClient, http, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { useCurrentUser } from '../hooks/useCurrentUser.js';
import Sidebar from '../components/Sidebar.jsx';

const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const ERC20_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], type: "function" }
];

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org')
});

export default function Dashboard() {
  const { user: privyUser } = usePrivy();
  const { user, loading, hasProfile } = useCurrentUser();
  const navigate = useNavigate();

  const [usdcBalance, setUsdcBalance] = useState('—');

  const walletAddress = privyUser?.wallet?.address
    || privyUser?.linkedAccounts?.find((a) => a.type === 'wallet')?.address
    || null;

  useEffect(() => {
    async function fetchBalance() {
      if (!walletAddress) return;
      try {
        const balanceRaw = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [walletAddress]
        });
        // USDC has 6 decimals
        setUsdcBalance(formatUnits(balanceRaw, 6));
      } catch (err) {
        console.error('Failed to fetch balance', err);
      }
    }
    fetchBalance();
  }, [walletAddress]);

  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : '—';

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-crown">👑</div>
        <p className="loading-text">Loading your arena...</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content" style={{ animation: 'fadeIn 0.3s ease-out' }}>

        {/* Header */}
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="subheading">Welcome Back</div>
              <h1 className="page-title">
                {hasProfile ? '⚔️ Your Arena' : '👋 Getting Started'}
              </h1>
              <p className="page-subtitle">Base Sepolia Testnet</p>
            </div>
            <button
              id="btn-enter-match"
              className="btn btn-primary btn-lg"
              onClick={() => navigate('/challenge')}
            >
              ⚔️ Enter Match
            </button>
          </div>
        </div>

        {/* Setup CTA — show if no Riot account linked */}
        {!hasProfile && (
          <div
            className="card card-gold"
            style={{ marginBottom: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}
            onClick={() => navigate('/setup')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 40 }}>🎮</div>
              <div>
                <div className="heading">Link Your Riot Account</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
                  Required to play wagered matches. Takes 10 seconds.
                </p>
              </div>
            </div>
            <button id="btn-setup-now" className="btn btn-primary" onClick={(e) => { e.stopPropagation(); navigate('/setup'); }}>
              Set Up Now →
            </button>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid-4" style={{ marginBottom: 32 }}>
          {[
            { label: 'USDC Balance', value: usdcBalance !== '—' ? `$${usdcBalance}` : '—', sub: 'Deposit to play', icon: '💵', color: 'var(--teal)' },
            { label: 'Matches Played', value: '0', sub: 'Start your first match', icon: '⚔️', color: 'var(--gold)' },
            { label: 'Win Rate', value: '—%', sub: 'No matches yet', icon: '📈', color: 'var(--purple-light)' },
            { label: 'Total Earnings', value: '$0.00', sub: 'USDC on Base', icon: '🏆', color: 'var(--gold)' },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="stat-label">{s.label}</div>
                <span style={{ fontSize: 20 }}>{s.icon}</span>
              </div>
              <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Wallet + Profile row */}
        <div className="grid-2" style={{ marginBottom: 32 }}>

          {/* Wallet Card */}
          <div className="card card-purple">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 className="heading">💼 Embedded Wallet</h2>
              <span className="badge badge-purple badge-dot badge-dot-pulse">Base Sepolia</span>
            </div>
            <div className="puuid-display" style={{ marginBottom: 16 }}>
              {walletAddress || 'No wallet found'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                id="btn-deposit"
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/deposit')}
              >
                💰 Deposit USDC
              </button>
              {walletAddress && (
                <a
                  href={`https://sepolia.basescan.org/address/${walletAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  View on Explorer ↗
                </a>
              )}
            </div>
          </div>

          {/* Riot Profile Card */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 className="heading">🎮 Riot Profile</h2>
              {hasProfile
                ? <span className="badge badge-teal badge-dot">Linked</span>
                : <span className="badge badge-danger badge-dot">Not linked</span>
              }
            </div>

            {hasProfile ? (
              <div>
                <div className="puuid-display" style={{ marginBottom: 16, fontSize: 11 }}>
                  PUUID: {user.riot_puuid}
                </div>
                <button
                  id="btn-relink-riot"
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigate('/setup')}
                >
                  Change Account
                </button>
              </div>
            ) : (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
                  You need to link your League of Legends account before you can join wagered matches.
                </p>
                <button
                  id="btn-link-now"
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate('/setup')}
                >
                  Link Riot Account →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Recent Matches placeholder */}
        <div className="card">
          <h2 className="heading" style={{ marginBottom: 24 }}>⚔️ Recent Matches</h2>
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <div className="empty-state-icon">🎯</div>
            <div className="empty-state-title">No matches yet</div>
            <p style={{ fontSize: 14 }}>
              Deposit USDC and challenge a player to start earning.
            </p>
            <button
              id="btn-first-match"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 16 }}
              onClick={() => navigate('/challenge')}
            >
              Find a Match
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}
