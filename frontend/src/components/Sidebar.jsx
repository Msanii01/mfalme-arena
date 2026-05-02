import { NavLink, useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { useCurrentUser, clearUserCache } from '../hooks/useCurrentUser.js';

// M10: Deposit USDC and Tournament Detail are still stubs (ComingSoon
// pages). The route handlers remain in App.jsx, but we hide the entries
// from the user-visible nav so we don't link to dead-end views.
const NAV = [
  { to: '/dashboard',   icon: '📊', label: 'Dashboard' },
  { to: '/challenge',   icon: '⚔️',  label: 'Challenge' },
  { to: '/tournaments', icon: '🏆', label: 'Tournaments' },
];

export default function Sidebar() {
  const { logout, user: privyUser } = usePrivy();
  const { user } = useCurrentUser();
  const navigate = useNavigate();

  const handleLogout = async () => {
    clearUserCache();
    await logout();
    navigate('/', { replace: true });
  };

  const initials = (privyUser?.email?.address || 'MA')[0].toUpperCase();
  const displayName = user?.riot_puuid
    ? `${user.riot_game_name || 'Champion'}`
    : privyUser?.email?.address?.split('@')[0] || 'Player';

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <span className="sidebar-logo-crown">👑</span>
        <div>
          <div className="sidebar-logo-text">MFALME</div>
          <div className="sidebar-logo-sub">The Arena</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Play</div>
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-item-icon">{icon}</span>
            {label}
          </NavLink>
        ))}

        <div className="nav-section-label" style={{ marginTop: 8 }}>Account</div>
        <NavLink
          to="/setup"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span className="nav-item-icon">🎮</span>
          Riot Profile
          {!user?.riot_puuid && (
            <span className="nav-item-badge">!</span>
          )}
        </NavLink>
      </nav>

      {/* User footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user" style={{ cursor: 'default' }}>
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name truncate">{displayName}</div>
            <div className="user-handle">Base Sepolia</div>
          </div>
        </div>
        <button
          id="btn-logout"
          className="btn btn-ghost btn-sm btn-full"
          onClick={handleLogout}
          style={{ marginTop: 8 }}
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
