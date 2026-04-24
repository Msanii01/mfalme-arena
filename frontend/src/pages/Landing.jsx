import { usePrivy } from '@privy-io/react-auth';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

export default function Landing() {
  const { login, authenticated, ready } = usePrivy();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && authenticated) navigate('/dashboard', { replace: true });
  }, [ready, authenticated, navigate]);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Background orbs */}
      <div className="hero-bg">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-orb hero-orb-3" />
        <div className="hero-grid" />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '40px 24px', maxWidth: '640px' }}>
        <div style={{ fontSize: '64px', marginBottom: '24px', filter: 'drop-shadow(0 0 24px rgba(245,166,35,0.6))', animation: 'float 3s ease-in-out infinite' }}>
          👑
        </div>

        <h1 className="display-xl" style={{ marginBottom: '16px' }}>
          <span className="text-gold">MFALME</span>
          <br />
          <span style={{ color: 'var(--text-primary)' }}>THE ARENA</span>
        </h1>

        <p className="body-lg" style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Compete. Wager. Win.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '48px' }}>
          Blockchain-powered skill-based gaming on Base Sepolia.
          <br />Gasless transactions. Real USDC prizes.
        </p>

        <button
          id="btn-login"
          className="btn btn-primary btn-xl"
          onClick={login}
          style={{ minWidth: '280px' }}
        >
          🚀 Enter the Arena
        </button>

        <p style={{ marginTop: '24px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Sign in with email or Google · Embedded wallet created automatically
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '32px', justifyContent: 'center', marginTop: '64px' }}>
          {[
            { label: 'Network', value: 'Base Sepolia' },
            { label: 'Currency', value: 'USDC' },
            { label: 'Gas', value: '$0.00' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 800, color: 'var(--gold)' }}>{s.value}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Region availability */}
        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>🌎 Americas Servers Only (Beta):</span>
          {['NA', 'BR', 'LAN', 'LAS'].map(r => (
            <span key={r} style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              background: 'rgba(245,166,35,0.08)',
              border: '1px solid rgba(245,166,35,0.2)',
              borderRadius: 5,
              padding: '2px 7px',
            }}>{r}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
