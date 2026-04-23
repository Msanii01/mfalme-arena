import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App.jsx';
import './styles/global.css';
import { setTokenGetter } from './services/api.js';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'cmoaen7e4000r0bjsresleyyn';

// Base Sepolia chain definition
const baseSepolia = {
  id: 84532,
  name: 'Base Sepolia',
  network: 'base-sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
  blockExplorers: { default: { name: 'Basescan', url: 'https://sepolia.basescan.org' } },
  testnet: true,
};

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: '#080A12', color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', fontFamily: 'monospace' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h1 style={{ color: '#F5A623', marginBottom: '12px' }}>Mfalme Arena — Startup Error</h1>
          <p style={{ color: '#aaa', marginBottom: '20px' }}>The app crashed before it could load.</p>
          <pre style={{ background: '#111', padding: '20px', borderRadius: '8px', border: '1px solid #333', color: '#ff6b6b', maxWidth: '800px', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: '13px' }}>
            {this.state.error?.toString()}{'\n\n'}{this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PrivyProvider
        appId={PRIVY_APP_ID || 'placeholder-set-vite-privy-app-id'}
        config={{
          loginMethods: ['email', 'google'],
          appearance: { theme: 'dark', accentColor: '#F5A623' },
          embeddedWallets: { createOnLogin: 'users-without-wallets' },
          smartWallets: {
            createOnLogin: 'all-users',
            requireSponsorship: true
          },
          defaultChain: baseSepolia,
          supportedChains: [baseSepolia],
        }}
        onSuccess={(user, isNewUser) => {
          // Inject the Privy token getter so api.js can attach it to every request
          if (window.__privyInstance) {
            setTokenGetter(() => window.__privyInstance.getAccessToken());
          }
        }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PrivyProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
