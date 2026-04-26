import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { setTokenGetter } from './services/api.js';
import { useCurrentUser } from './hooks/useCurrentUser.js';
import Landing from './pages/Landing.jsx';
import AccountSetup from './pages/AccountSetup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import DepositFlow from './pages/DepositFlow.jsx';
import ChallengeLobby from './pages/ChallengeLobby.jsx';
import MatchStatus from './pages/MatchStatus.jsx';
import TournamentLobby from './pages/TournamentLobby.jsx';
import TournamentDetail from './pages/TournamentDetail.jsx';
import HostDashboard from './pages/HostDashboard.jsx';
import TicTacArena from './pages/TicTacArena.jsx';

/** Injects the Privy token getter into the API service after auth is ready */
function PrivyTokenInjector() {
  const { getAccessToken, ready, authenticated } = usePrivy();
  useEffect(() => {
    if (ready && authenticated) {
      setTokenGetter(getAccessToken);
    }
  }, [ready, authenticated, getAccessToken]);
  return null;
}

/** Guards authenticated routes. Riot profile checks are handled per-page if needed. */
function ProtectedRoute({ children, requireProfile = false }) {
  const { ready, authenticated } = usePrivy();
  const { loading, hasProfile } = useCurrentUser();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="loading-screen">
        <div className="loading-crown">👑</div>
        <p className="loading-text">Loading Mfalme Arena...</p>
      </div>
    );
  }

  if (!authenticated) return <Navigate to="/" replace />;

  // While we check the profile, show a spinner
  if (requireProfile && loading) {
    return (
      <div className="loading-screen">
        <div className="loading-crown">👑</div>
        <p className="loading-text">Loading your profile...</p>
      </div>
    );
  }

  // Redirect to account setup if no Riot profile, unless we're already on /setup
  if (requireProfile && !hasProfile && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  return children;
}

export default function App() {
  const { ready, authenticated } = usePrivy();

  if (!ready) {
    return (
      <div className="loading-screen">
        <div className="loading-crown">👑</div>
        <p className="loading-text">Prove Your Reign</p>
      </div>
    );
  }

  return (
    <>
      <PrivyTokenInjector />
      <Routes>
        <Route path="/" element={authenticated ? <Navigate to="/dashboard" replace /> : <Landing />} />
        {/* requireProfile=false so un-linked users can reach setup */}
        <Route path="/setup" element={<ProtectedRoute requireProfile={false}><AccountSetup /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/deposit" element={<ProtectedRoute><DepositFlow /></ProtectedRoute>} />
        <Route path="/challenge" element={<ProtectedRoute><ChallengeLobby /></ProtectedRoute>} />
        <Route path="/match/:id" element={<ProtectedRoute><MatchStatus /></ProtectedRoute>} />
        <Route path="/tournaments" element={<TournamentLobby />} />
        <Route path="/tournaments/:id" element={<TournamentDetail />} />
        <Route path="/host" element={<ProtectedRoute><HostDashboard /></ProtectedRoute>} />
        <Route path="/tictactoe/:id" element={<ProtectedRoute><TicTacArena /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

