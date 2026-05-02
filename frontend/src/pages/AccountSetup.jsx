import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { authAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

const SUPPORTED_PLATFORMS = [
  { code: 'na1', label: 'NA — North America' },
  { code: 'br1', label: 'BR — Brazil' },
  { code: 'la1', label: 'LAN — Latin America N.' },
  { code: 'la2', label: 'LAS — Latin America S.' },
];

function truncatePuuid(p) {
  if (!p || typeof p !== 'string' || p.length < 12) return p || '—';
  return `${p.slice(0, 6)}…${p.slice(-4)}`;
}

function describeError(err, fallback) {
  const status = err?.response?.status;
  const msg = err?.response?.data?.error;
  if (status === 404) return msg || 'Riot account not found. Check your Game Name and Tag Line.';
  if (status === 409) return msg || 'This Riot account is already linked to another player.';
  if (status === 410) return msg || 'Verification window expired — please start over.';
  if (status === 401) return msg || 'Session expired. Sign out and back in, then try again.';
  if (status === 403) return msg || 'Riot account is on an unsupported region.';
  if (status === 429) return 'Riot is rate-limiting requests — wait a moment and try again.';
  if (!err?.response) return 'Cannot reach server. Check your internet connection.';
  return msg || fallback || 'Something went wrong. Please try again.';
}

export default function AccountSetup() {
  const { user: privyUser, logout, getAccessToken } = usePrivy();
  const { user: dbUser, refetch } = useCurrentUser();
  const navigate = useNavigate();

  // Form state
  const [gameName, setGameName] = useState('');
  const [tagLine, setTagLine]   = useState('');
  const [platform, setPlatform] = useState(SUPPORTED_PLATFORMS[0].code);

  // Flow state
  const [phase, setPhase]   = useState('form');     // 'form' | 'verify' | 'success'
  const [attempt, setAttempt] = useState(null);     // { attemptId, targetIconId, currentIconId, expiresAt, riot }
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Async / messaging
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(null);

  const handleSignOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  // Countdown for the verify phase
  const intervalRef = useRef(null);
  useEffect(() => {
    if (phase !== 'verify' || !attempt?.expiresAt) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [phase, attempt?.expiresAt]);

  const handleStart = async (e) => {
    e.preventDefault();
    if (!gameName.trim() || !tagLine.trim()) {
      setError('Please fill in both Game Name and Tag Line.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const freshToken = await getAccessToken();
      if (!freshToken) {
        setError('Session expired. Please sign out and sign back in.');
        return;
      }
      const result = await authAPI.startRiotLink(gameName.trim(), tagLine.trim(), platform, freshToken);
      setAttempt(result);
      setPhase('verify');
    } catch (err) {
      setError(describeError(err, 'Could not start verification.'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!attempt?.attemptId) return;
    setLoading(true);
    setError(null);
    try {
      const freshToken = await getAccessToken();
      if (!freshToken) {
        setError('Session expired. Please sign out and sign back in.');
        return;
      }
      const result = await authAPI.verifyRiotLink(attempt.attemptId, freshToken);
      setSuccess(`Linked! Welcome, ${result.riot.gameName}#${result.riot.tagLine} 🎮`);
      setPhase('success');
      await refetch();
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 400 && typeof data?.currentIconId === 'number') {
        setError(`We still see icon #${data.currentIconId}. Save the icon change in-game (close & reopen the client if needed), then click Verify again.`);
      } else if (status === 410) {
        setError('Verification window expired — please start over.');
        setPhase('form');
        setAttempt(null);
      } else {
        setError(describeError(err, 'Verification failed.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = () => {
    setPhase('form');
    setAttempt(null);
    setError(null);
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '40px 24px' }}>
      <button
        onClick={handleSignOut}
        style={{
          position: 'absolute', top: 20, right: 20, zIndex: 10,
          background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)',
          borderRadius: 8, color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
          padding: '6px 14px', cursor: 'pointer',
        }}
        aria-label="Sign out"
      >
        Sign Out
      </button>

      <div className="hero-bg">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-grid" />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 480, animation: 'fadeIn 0.4s ease-out' }}>
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

        <div className="card card-gold" style={{ padding: 40 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 12, filter: 'drop-shadow(0 0 16px rgba(245,166,35,0.5))' }}>🎮</div>
            <h1 className="display-md" style={{ marginBottom: 8 }}>Link Your Riot Account</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              We verify ownership by asking you to change your in-game profile icon.
            </p>
          </div>

          {dbUser?.riot_puuid && phase === 'form' && !success && (
            <div className="alert alert-success" style={{ marginBottom: 24 }}>
              <span>✅</span>
              <div>
                <div style={{ fontWeight: 600 }}>Riot account already linked!</div>
                <div className="puuid-display" style={{ marginTop: 8 }} title={dbUser.riot_puuid}>
                  {truncatePuuid(dbUser.riot_puuid)}
                </div>
              </div>
            </div>
          )}

          {success && (
            <div className="alert alert-success" style={{ marginBottom: 24 }}>
              <span>🎉</span>
              <span style={{ fontWeight: 600 }}>{success} Redirecting…</span>
            </div>
          )}

          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 24 }}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Phase 1 — form */}
          {phase === 'form' && !success && (
            <form onSubmit={handleStart} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="input-gamename">Riot ID</label>
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
                <p className="form-hint">Example: PlayerName#NA1 — case-sensitive.</p>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="input-platform">Region</label>
                <select
                  id="input-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  disabled={loading}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  {SUPPORTED_PLATFORMS.map((p) => (
                    <option key={p.code} value={p.code}>{p.label}</option>
                  ))}
                </select>
                <p className="form-hint">Pick the server your account is on.</p>
              </div>

              <button
                id="btn-link-riot-start"
                type="submit"
                className={`btn btn-primary btn-full btn-lg${loading ? ' btn-loading' : ''}`}
                disabled={loading || !gameName.trim() || !tagLine.trim()}
              >
                {loading ? 'Looking up…' : '⚡ Continue'}
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

          {/* Phase 2 — verify */}
          {phase === 'verify' && attempt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{
                background: 'rgba(245,166,35,0.08)',
                border: '1px solid rgba(245,166,35,0.3)',
                borderRadius: 12,
                padding: 18,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Prove ownership
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)' }}>
                  <li>Open the League of Legends client.</li>
                  <li>
                    Set your <strong>Profile Icon</strong> to icon
                    {' '}<strong style={{ color: 'var(--gold)' }}>#{attempt.targetIconId}</strong>.
                  </li>
                  <li>
                    Save the change (close and reopen the profile if needed) — then click <strong>Verify</strong> below.
                  </li>
                </ol>
                <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  Time remaining: <strong>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</strong>
                  {typeof attempt.currentIconId === 'number' && (
                    <> · Current icon: #{attempt.currentIconId}</>
                  )}
                </p>
              </div>

              <button
                id="btn-link-riot-verify"
                type="button"
                onClick={handleVerify}
                className={`btn btn-primary btn-full btn-lg${loading ? ' btn-loading' : ''}`}
                disabled={loading || secondsLeft === 0}
              >
                {loading ? 'Checking…' : (secondsLeft === 0 ? 'Window expired' : 'I changed my icon — Verify')}
              </button>

              <button
                type="button"
                onClick={handleStartOver}
                className="btn btn-ghost btn-full"
              >
                Start over
              </button>
            </div>
          )}
        </div>

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
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            Americas only for now (NA, BR, LAN, LAS). EU / KR / SEA coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
