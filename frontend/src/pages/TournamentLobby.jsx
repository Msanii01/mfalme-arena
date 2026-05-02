import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { usePrivy } from '@privy-io/react-auth';
import Sidebar from '../components/Sidebar.jsx';
import { tournamentAPI, tictactoeAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

export default function TournamentLobby() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  // Split state so the Register and Enter Arena buttons are independently in-flight tracked.
  const [registeringId, setRegisteringId] = useState(null);
  const [enteringId, setEnteringId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = useCallback(async () => {
    try {
      const data = await tournamentAPI.getTournaments();
      setTournaments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTournaments();
    // Auto-poll every 15 seconds so completed tournaments disappear without manual refresh
    const interval = setInterval(fetchTournaments, 15000);
    return () => clearInterval(interval);
  }, [fetchTournaments]);

  // Live socket updates: refresh lobby when a tournament is settled.
  // TODO: backend currently emits `settlement_success` to a per-game room
  //       (e.g. settle_<tournamentId>) — broadcasting globally won't catch
  //       individual settlements. We attempt to join a `tournament_lobby`
  //       room so the backend can broadcast lobby-level updates there.
  //       If the backend doesn't have this room wired, the listener above
  //       simply never fires, and the 15s polling interval is the fallback.
  useEffect(() => {
    if (!ready || !authenticated) return undefined;
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:3001', {
      // Async auth callback: socket.io-client invokes this on every (re)connect,
      // giving us a fresh Privy token even after token rotation.
      auth: async (cb) => {
        try {
          const token = await getAccessToken();
          cb({ token: token || '' });
        } catch (e) {
          cb({ token: '' });
        }
      },
    });
    socket.on('connect', () => {
      // Subscribe to a lobby-wide room so we can hear settlement broadcasts.
      // Backend gap: confirm a `tournament_lobby` room exists in the socket server;
      // if not, this emit is a no-op and we'll fall back to polling.
      socket.emit('join', 'tournament_lobby');
    });
    socket.on('connect_error', (err) => {
      if (import.meta.env.DEV) console.warn('Tournament socket auth failed:', err?.message);
    });
    socket.on('settlement_success', () => {
      // A game just finished — refresh the tournament list
      fetchTournaments();
    });
    return () => socket.disconnect();
  }, [fetchTournaments, ready, authenticated, getAccessToken]);

  const handleRegister = async (id) => {
    if (registeringId) return;
    setRegisteringId(id);
    setError(null);
    try {
      await tournamentAPI.registerTournament(id);
      fetchTournaments(); // refresh list
    } catch (err) {
      // H5: 409 → friendly message
      const status = err.response?.status;
      if (status === 409) {
        setError('Tournament already full');
      } else {
        setError(err.response?.data?.error || 'Failed to register');
      }
    } finally {
      setRegisteringId(null);
    }
  };

  const handleEnterArena = async (id) => {
    if (enteringId) return;
    setEnteringId(id);
    setError(null);
    try {
      const game = await tictactoeAPI.initGame(id, null);
      navigate(`/tictactoe/${game.game_id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to enter arena');
      setEnteringId(null);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content" style={{ animation: 'fadeIn 0.3s ease-out' }}>
        <div className="page-header" style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏆</div>
          <h1 className="page-title display-md" style={{ marginBottom: 16 }}>Tournament Lobby</h1>
          <p className="page-subtitle" style={{ maxWidth: 600, margin: '0 auto' }}>
            Compete in admin-sponsored 1v1 matches. The prize pool is guaranteed in the smart contract. Winner takes all!
          </p>
        </div>

        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 24 }}>
              <span>⚠️</span> {error}
            </div>
          )}

          {loading ? (
            <div className="text-center text-muted" style={{ padding: 40 }}>Loading tournaments...</div>
          ) : tournaments.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 20px' }}>
              <div className="empty-state-icon">🛡️</div>
              <div className="empty-state-title">No Active Tournaments</div>
              <p>Check back later! Admins regularly post new prize pools.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {tournaments.map(t => {
                const isRegistered = t.player_a_id === user?.user_id || t.player_b_id === user?.user_id;
                const isCompleted = t.status === 'completed' || t.status === 'cancelled';
                const isMatchReady = (t.status === 'full' || t.status === 'active') && isRegistered;
                
                return (
                  <div key={t.tournament_id} className="card" style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 24, border: isRegistered ? '2px solid var(--gold)' : '1px solid var(--border-default)'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <h2 className="heading">{t.name}</h2>
                        <span className={`badge ${
                          t.status === 'open' ? 'badge-teal' :
                          t.status === 'full' ? 'badge-purple' :
                          t.status === 'completed' ? 'badge-neutral' : 'badge-neutral'
                        }`}>
                          {t.status.toUpperCase()}
                        </span>
                        {isRegistered && !isCompleted && <span className="badge badge-gold">REGISTERED</span>}
                      </div>
                      
                      <div style={{ display: 'flex', gap: 24, color: 'var(--text-muted)', fontSize: 14 }}>
                        <div>💰 Prize Pool: <strong className="text-gold">{t.prize_pool} USDC</strong></div>
                        <div>👥 Players: <strong>{(t.player_a_id ? 1 : 0) + (t.player_b_id ? 1 : 0)} / 2</strong></div>
                      </div>
                      
                      {(t.player_a_id || t.player_b_id) && (
                        <div style={{ marginTop: 12, fontSize: 13, display: 'flex', gap: 8 }}>
                          {t.player_a_name && <span className="badge badge-neutral">{t.player_a_name}#{t.player_a_tag}</span>}
                          {t.player_b_name && <span className="badge badge-neutral">vs</span>}
                          {t.player_b_name && <span className="badge badge-neutral">{t.player_b_name}#{t.player_b_tag}</span>}
                        </div>
                      )}
                    </div>
                    
                    <div>
                      {t.status === 'open' && !isRegistered && (
                        <button
                          className={`btn btn-primary${registeringId === t.tournament_id ? ' btn-loading' : ''}`}
                          onClick={() => handleRegister(t.tournament_id)}
                          disabled={!!registeringId}
                        >
                          {registeringId === t.tournament_id ? 'Joining...' : 'Register to Play'}
                        </button>
                      )}
                      {t.status === 'open' && isRegistered && (
                        <div className="text-gold" style={{ fontWeight: 600 }}>Waiting for opponent...</div>
                      )}
                      {isMatchReady && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                          <div className="text-teal" style={{ fontWeight: 600 }}>Match Ready!</div>
                          <button
                            className={`btn btn-secondary${enteringId === t.tournament_id ? ' btn-loading' : ''}`}
                            onClick={() => handleEnterArena(t.tournament_id)}
                            disabled={!!enteringId}
                          >
                            {enteringId === t.tournament_id ? 'Entering...' : 'Enter Arena ⚔️'}
                          </button>
                        </div>
                      )}
                      {(t.status === 'full' || t.status === 'active') && !isRegistered && (
                        <button className="btn btn-ghost" disabled>Registration Closed</button>
                      )}
                      {isCompleted && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 22, marginBottom: 4 }}>🏆</div>
                          <div className="text-muted" style={{ fontSize: 13 }}>Completed</div>
                          {t.settle_tx && (
                            <a
                              href={`https://sepolia.basescan.org/tx/${t.settle_tx}`}
                              target="_blank" rel="noreferrer"
                              style={{ fontSize: 12, color: 'var(--gold)', textDecoration: 'underline' }}
                            >
                              View Prize Tx ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
