import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import { tournamentAPI, tictactoeAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

export default function TournamentLobby() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = async () => {
    try {
      const data = await tournamentAPI.getTournaments();
      setTournaments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (id) => {

    setProcessingId(id);
    setError(null);
    try {
      await tournamentAPI.registerTournament(id);
      fetchTournaments(); // refresh list
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to register');
    } finally {
      setProcessingId(null);
    }
  };

  const handleEnterArena = async (id) => {
    setProcessingId(id);
    setError(null);
    try {
      const { game } = await tictactoeAPI.initGame(id, null);
      navigate(`/tictactoe/${game.game_id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to enter arena');
      setProcessingId(null);
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
                const isFull = t.status === 'full' || t.status === 'active' || t.status === 'completed';
                
                return (
                  <div key={t.tournament_id} className="card" style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 24, border: isRegistered ? '2px solid var(--gold)' : '1px solid var(--border-default)'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <h2 className="heading">{t.name}</h2>
                        <span className={`badge ${t.status === 'open' ? 'badge-teal' : t.status === 'full' ? 'badge-purple' : 'badge-neutral'}`}>
                          {t.status.toUpperCase()}
                        </span>
                        {isRegistered && <span className="badge badge-gold">REGISTERED</span>}
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
                          className={`btn btn-primary${processingId === t.tournament_id ? ' btn-loading' : ''}`}
                          onClick={() => handleRegister(t.tournament_id)}
                          disabled={processingId === t.tournament_id}
                        >
                          {processingId === t.tournament_id ? 'Joining...' : 'Register to Play'}
                        </button>
                      )}
                      {t.status === 'open' && isRegistered && (
                        <div className="text-gold" style={{ fontWeight: 600 }}>Waiting for opponent...</div>
                      )}
                      {isFull && isRegistered && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                          <div className="text-teal" style={{ fontWeight: 600 }}>Match Ready!</div>
                          <button 
                            className={`btn btn-secondary${processingId === t.tournament_id ? ' btn-loading' : ''}`}
                            onClick={() => handleEnterArena(t.tournament_id)}
                            disabled={processingId === t.tournament_id}
                          >
                            {processingId === t.tournament_id ? 'Entering...' : 'Enter Arena ⚔️'}
                          </button>
                        </div>
                      )}
                      {isFull && !isRegistered && (
                        <button className="btn btn-ghost" disabled>Registration Closed</button>
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
