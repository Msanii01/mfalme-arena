import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { authAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

export default function AccountSetup() {
  const { user: privyUser } = usePrivy();
  const { user: dbUser, refetch } = useCurrentUser();
  const navigate = useNavigate();

  const [gameName, setGameName] = useState('');
  const [tagLine, setTagLine]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(null);

  // Derive the embedded wallet address
  const walletAddress = privyUser?.wallet?.address
    || privyUser?.linkedAccounts?.find((a) => a.type === 'wallet')?.address
    || '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!gameName.trim() || !tagLine.trim()) {
      setError('Please fill in both Game Name and Tag Line.');
      return;
    }
    if (!walletAddress) {
      setError('No embedded wallet found. Please sign out and sign in again.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await authAPI.linkRiot(gameName.trim(), tagLine.trim(), walletAddress);
      setSuccess(`Linked! Welcome, ${result.riot.gameName}#${result.riot.tagLine} 🎮`);
      await refetch();
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch (err) {
      const msg = err.response?.data?.error;
      if (err.response?.status === 404) {
        setError(`Riot account "${gameName}#${tagLine}" not found. Check your Game Name and Tag Line.`);
      } else if (err.response?.status === 409) {
        setError('This Riot account is already linked to another Mfalme player.');
      } else {
        setError(msg || 'Something went wrong. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '40px 24px' }}>
      {/* Background */}
      <div className="hero-bg">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-grid" />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '480px', animation: 'fadeIn 0.4s ease-out' }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32, justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#080A12' }}>✓</div>
            <span style={{ fontSize: 13, color: 'var(--teal)', fontWeight: 600 }}>Sign In</span>
          </div>
          <div style={{ width: 32, height: 1, background: 'var(--border-gold)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--gradient-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#080A12' }}>2</div>
            <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600 }}>Link Riot</span>
          </div>
          <div style={{ width: 32, height: 1, background: 'var(--border-subtle)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>3</div>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Play</span>
          </div>
        </div>

        {/* Card */}
        <div className="card card-gold" style={{ padding: '40px' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 12, filter: 'drop-shadow(0 0 16px rgba(245,166,35,0.5))' }}>🎮</div>
            <h1 className="display-md" style={{ marginBottom: 8 }}>Link Your Riot Account</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              We'll verify your League of Legends account to enable wagered matches.
            </p>
          </div>

          {/* Already linked */}
          {dbUser?.riot_puuid && !success && (
            <div className="alert alert-success" style={{ marginBottom: 24 }}>
              <span>✅</span>
              <div>
                <div style={{ fontWeight: 600 }}>Riot account already linked!</div>
                <div className="puuid-display" style={{ marginTop: 8 }}>{dbUser.riot_puuid}</div>
              </div>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="alert alert-success" style={{ marginBottom: 24 }}>
              <span>🎉</span>
              <span style={{ fontWeight: 600 }}>{success} Redirecting to Dashboard...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 24 }}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          {!success && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="form-group">
                <label className="form-label">Riot ID</label>
                <div className="riot-id-input">
                  <input
                    id="input-gamename"
                    type="text"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    placeholder="GameName"
                    disabled={loading}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="riot-id-separator">#</span>
                  <input
                    id="input-tagline"
                    type="text"
                    value={tagLine}
                    onChange={(e) => setTagLine(e.target.value)}
                    placeholder="TAG"
                    disabled={loading}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={8}
                  />
                </div>
                <p className="form-hint">Example: Faker#KR1 · Case-sensitive · Americas region</p>
              </div>

              {walletAddress && (
                <div className="form-group">
                  <label className="form-label">Linked Wallet</label>
                  <div className="puuid-display">{walletAddress}</div>
                </div>
              )}

              <button
                id="btn-link-riot"
                type="submit"
                className={`btn btn-primary btn-full btn-lg${loading ? ' btn-loading' : ''}`}
                disabled={loading || !gameName.trim() || !tagLine.trim()}
              >
                {loading ? 'Verifying…' : '⚡ Link Riot Account'}
              </button>

              {dbUser?.riot_puuid && (
                <button
                  id="btn-skip-setup"
                  type="button"
                  className="btn btn-ghost btn-full"
                  onClick={() => navigate('/dashboard', { replace: true })}
                >
                  Keep existing account
                </button>
              )}
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          Only League of Legends accounts on Americas servers are supported during beta.
        </p>
      </div>
    </div>
  );
}
