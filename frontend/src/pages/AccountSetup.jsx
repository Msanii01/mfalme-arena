import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { authAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

export default function AccountSetup() {
  const { user: privyUser, logout, getAccessToken } = usePrivy();
  const { user: dbUser, refetch } = useCurrentUser();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

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
      // Explicitly get a fresh Privy token and pass it directly.
      // This bypasses the async interceptor which was silently dropping the token.
      const freshToken = await getAccessToken();
      if (!freshToken) {
        setError('Session expired. Please use the Sign Out button above and sign back in.');
        return;
      }

      const result = await authAPI.linkRiot(gameName.trim(), tagLine.trim(), walletAddress, freshToken);
      setSuccess(`Linked! Welcome, ${result.riot.gameName}#${result.riot.tagLine} 🎮`);
      await refetch();
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch (err) {
      const msg = err.response?.data?.error;
      const status = err.response?.status;
      if (status === 404) {
        setError(`Riot account "${gameName}#${tagLine}" not found. Check your Game Name and Tag Line.`);
      } else if (status === 409) {
        setError('This Riot account is already linked to another Mfalme player.');
      } else if (status === 401) {
        setError(msg || 'Session expired. Please sign out and sign back in, then try again.');
      } else if (!err.response) {
        setError('Cannot reach server. Check your internet connection.');
      } else {
        let errorMsg = `Error ${status}: ${msg || 'Something went wrong. Try again.'}`;
        if (err.response?.data?.module) {
          errorMsg += ` [Mod: ${err.response.data.module}]`;
        }
        if (err.response?.data?.methods) {
          errorMsg += ` [Methods: ${err.response.data.methods}]`;
        }
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '40px 24px' }}>
      {/* Sign out button — top right */}
      <button
        onClick={handleSignOut}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          zIndex: 10,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          color: 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 600,
          padding: '6px 14px',
          cursor: 'pointer',
        }}
      >
        Sign Out
      </button>
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
                <p className="form-hint">Example: PlayerName#NA1 · Case-sensitive · Must be an Americas server account</p>
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

        {/* Region notice */}
        <div style={{
          marginTop: 20,
          background: 'rgba(245,166,35,0.06)',
          border: '1px solid rgba(245,166,35,0.2)',
          borderRadius: 12,
          padding: '14px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>🌎</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Supported Regions (Beta)</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {['NA — North America', 'BR — Brazil', 'LAN — Latin America N.', 'LAS — Latin America S.'].map(r => (
              <span key={r} style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                padding: '3px 8px',
              }}>{r}</span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            EU, KR, and SEA region support is coming in a future update. Your account must be registered on one of the Americas servers above.
          </p>
        </div>
      </div>
    </div>
  );
}
