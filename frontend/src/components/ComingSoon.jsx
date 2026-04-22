// Shared stub for pages being built in later phases
export function ComingSoon({ phase, title, icon }) {
  return (
    <div className="app-layout">
      <main className="main-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>{icon || '🔧'}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '9999px', background: 'var(--purple-muted)', border: '1px solid rgba(123,97,255,0.3)', color: 'var(--purple-light)', fontFamily: 'var(--font-display)', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '16px' }}>
            ⏳ Phase {phase}
          </div>
          <h1 className="display-md" style={{ marginBottom: '8px' }}>{title}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>This page will be built in Phase {phase}.</p>
        </div>
      </main>
    </div>
  );
}
