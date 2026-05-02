import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { createPublicClient, http, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { useCurrentUser } from '../hooks/useCurrentUser.js';
import Sidebar from '../components/Sidebar.jsx';
import { statsAPI } from '../services/api.js';
import { USDC_ADDRESS } from '../config/contracts.js';

const ERC20_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], type: "function" }
];

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

// Format a numeric balance string for display. Sub-cent positive balances
// collapse to "<$0.01" so we don't misleadingly show $0.00.
function formatUsd(rawBalance) {
  const n = parseFloat(rawBalance);
  if (!Number.isFinite(n)) return '—';
  if (n > 0 && n < 0.01) return '<$0.01';
  return USD_FORMATTER.format(n);
}

// Truncate a PUUID for UI display (privacy + readability). Falls back to a
// single em-dash when missing.
function truncatePuuid(p) {
  if (!p || typeof p !== 'string' || p.length < 12) return p || '—';
  return `${p.slice(0, 6)}…${p.slice(-4)}`;
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org')
});

export default function Dashboard() {
  const { user: privyUser } = usePrivy();
  const { user, loading, hasProfile } = useCurrentUser();
  const navigate = useNavigate();

  const [usdcBalance, setUsdcBalance] = useState('—');
  const [stats, setStats] = useState(null);
  const [copied, setCopied] = useState(false);

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
        setUsdcBalance(formatUnits(balanceRaw, 6));
      } catch (err) {
        // M2: don't dump full axios/RPC error objects (URLs, tokens, etc).
        console.error('Failed to fetch balance', err?.response?.status, err?.message);
      }
    }
    fetchBalance();
  }, [walletAddress]);

  useEffect(() => {
    statsAPI.getMyStats()
      .then(s => setStats(s))
      .catch(err => console.error('Failed to fetch stats', err?.response?.status, err?.message));
  }, []);

  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : '—';

  const handleCopy = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

        <div className="grid-3" style={{ marginBottom: 32 }}>
          {/* Riot CTA */}
          <div
            className="card card-gold"
            role="button"
            tabIndex={0}
            aria-label={hasProfile ? 'Manage Riot account' : 'Link Riot account'}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/setup')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/setup'); } }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎮</div>
            <div className="heading">Link Riot Account</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 16 }}>
              Required for 1v1 LoL wagered matches.
            </p>
            <button className="btn btn-primary btn-sm btn-full" onClick={(e) => { e.stopPropagation(); navigate('/setup'); }}>
              {hasProfile ? 'Manage Account' : 'Set Up Now'}
            </button>
          </div>

          {/* Tournament CTA */}
          <div
            className="card card-purple"
            role="button"
            tabIndex={0}
            aria-label="Join a tournament"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/tournaments')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/tournaments'); } }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
            <div className="heading">Join Tournament</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 16 }}>
              Compete in sponsored prize pools.
            </p>
            <button className="btn btn-primary btn-sm btn-full" onClick={(e) => { e.stopPropagation(); navigate('/tournaments'); }}>
              View Lobbies
            </button>
          </div>

          {/* Host CTA */}
          <div
            className="card"
            role="button"
            tabIndex={0}
            aria-label="Open host dashboard"
            style={{ cursor: 'pointer', border: '1px solid var(--teal)' }}
            onClick={() => navigate('/host')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/host'); } }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>👑</div>
            <div className="heading">Become a Host</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 16 }}>
              Sponsor a prize pool for the community.
            </p>
            <button className="btn btn-secondary btn-sm btn-full" onClick={(e) => { e.stopPropagation(); navigate('/host'); }}>
              Host Dashboard
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid-4" style={{ marginBottom: 32 }}>
          {[
            { label: 'USDC Balance',   value: usdcBalance !== '—' ? formatUsd(usdcBalance) : '—', sub: 'Wallet on Base Sepolia', icon: '💵', color: 'var(--teal)' },
            { label: 'Matches Played', value: stats ? stats.totalPlayed : '—', sub: stats?.totalPlayed === 0 ? 'Start your first match' : `${stats?.wins} wins`, icon: '⚔️', color: 'var(--gold)' },
            { label: 'Win Rate',       value: stats?.winRate != null ? `${stats.winRate}%` : '—%', sub: stats?.totalPlayed ? `${stats.totalPlayed} games` : 'No matches yet', icon: '📈', color: 'var(--purple-light)' },
            { label: 'Total Earnings', value: stats ? formatUsd(stats.totalEarnings) : '$0.00', sub: 'USDC on Base', icon: '🏆', color: 'var(--gold)' },
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
            <div className="puuid-display" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{walletAddress || 'No wallet found'}</span>
              {walletAddress && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 8px', marginLeft: 8, display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={handleCopy}
                  title="Copy Wallet Address"
                  aria-label="Copy wallet address"
                >
                  {copied ? '✅ Copied' : '📋 Copy'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
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
                <div
                  className="puuid-display"
                  style={{ marginBottom: 16, fontSize: 11 }}
                  title={user.riot_puuid}
                >
                  PUUID: {truncatePuuid(user.riot_puuid)}
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

        {/* Recent Matches */}
        <div className="card">
          <h2 className="heading" style={{ marginBottom: 24 }}>⚔️ Recent Matches</h2>
          {stats?.recentGames?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {stats.recentGames.map(g => (
                <div key={g.game_id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)',
                  border: `1px solid ${g.result === 'win' ? 'var(--teal)' : g.result === 'loss' ? 'var(--danger)' : 'var(--border-default)'}`
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{g.tournament_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {new Date(g.played_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ color: 'var(--gold)', fontWeight: 600, fontSize: 14 }}>
                      {parseFloat(g.prize_pool).toFixed(2)} USDC
                    </span>
                    <span style={{
                      padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                      background: g.result === 'win' ? 'rgba(0,210,163,0.15)' : g.result === 'loss' ? 'rgba(255,77,77,0.15)' : 'rgba(255,255,255,0.08)',
                      color: g.result === 'win' ? 'var(--teal)' : g.result === 'loss' ? 'var(--danger)' : 'var(--text-muted)'
                    }}>
                      {g.result === 'win' ? '🏆 WIN' : g.result === 'loss' ? '💀 LOSS' : '🤝 DRAW'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '32px 16px' }}>
              <div className="empty-state-icon">🎯</div>
              <div className="empty-state-title">No matches yet</div>
              <p style={{ fontSize: 14 }}>Join a tournament to start building your record.</p>
              <button id="btn-first-match" className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => navigate('/tournaments')}>
                Find a Tournament
              </button>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
