import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import { matchAPI, tictactoeAPI } from '../services/api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

export default function ChallengeLobby() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  
  const [gameMode, setGameMode] = useState('lol'); // 'lol' or 'tictactoe'
  const [matches, setMatches] = useState([]);
  const [tttChallenges, setTttChallenges] = useState([]);
  
  const [loading, setLoading] = useState(true);
  
  // LoL Form State
  const [gameName, setGameName] = useState('');
  const [tagLine, setTagLine] = useState('');
  
  // Tic-Tac-Toe Form State
  const [opponentWallet, setOpponentWallet] = useState('');
  
  const [stake, setStake] = useState('10');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (gameMode === 'lol') {
      fetchMatches();
    } else {
      fetchTttChallenges();
    }
  }, [gameMode]);

  const fetchMatches = async () => {
    setLoading(true);
    try {
      const data = await matchAPI.getMatches();
      setMatches(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTttChallenges = async () => {
    setLoading(true);
    try {
      const data = await tictactoeAPI.getMyChallenges();
      setTttChallenges(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChallenge = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      if (gameMode === 'lol') {
        if (!gameName || !tagLine || !stake) return;
        const match = await matchAPI.createMatch(gameName.trim(), tagLine.trim(), stake);
        navigate(`/match/${match.match_id}`);
      } else {
        if (!opponentWallet || !stake) return;
        const game = await tictactoeAPI.directChallenge(opponentWallet.trim(), stake);
        navigate(`/tictactoe/${game.game_id}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create challenge');
    } finally {
      setCreating(false);
    }
  };

  const handleAcceptTtt = async (gameId) => {
    try {
      await tictactoeAPI.acceptChallenge(gameId);
      navigate(`/tictactoe/${gameId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept challenge');
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content" style={{ animation: 'fadeIn 0.3s ease-out' }}>
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 className="page-title">⚔️ Challenge Lobby</h1>
            <p className="page-subtitle">Find an opponent and wager USDC</p>
          </div>
          
          <div style={{ display: 'flex', gap: 8, background: 'var(--bg-input)', padding: 4, borderRadius: 'var(--radius-lg)' }}>
            <button 
              className={`btn ${gameMode === 'lol' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => setGameMode('lol')}
              style={{ borderRadius: 'var(--radius-md)' }}
            >
              League of Legends
            </button>
            <button 
              className={`btn ${gameMode === 'tictactoe' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => setGameMode('tictactoe')}
              style={{ borderRadius: 'var(--radius-md)' }}
            >
              Tic-Tac-Toe
            </button>
          </div>
        </div>

        <div className="grid-2">
          {/* Challenge Form */}
          <div className="card card-gold">
            <h2 className="heading" style={{ marginBottom: 24 }}>Issue a Challenge</h2>
            {error && (
              <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                <span>⚠️</span> {error}
              </div>
            )}
            <form onSubmit={handleChallenge} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {gameMode === 'lol' ? (
                <div className="form-group">
                  <label className="form-label">Opponent Riot ID</label>
                  <div className="riot-id-input">
                    <input
                      type="text"
                      value={gameName}
                      onChange={(e) => setGameName(e.target.value)}
                      placeholder="GameName"
                      required
                    />
                    <span className="riot-id-separator">#</span>
                    <input
                      type="text"
                      value={tagLine}
                      onChange={(e) => setTagLine(e.target.value)}
                      placeholder="TAG"
                      maxLength={8}
                      required
                    />
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Opponent Wallet Address</label>
                  <input
                    type="text"
                    className="form-input"
                    value={opponentWallet}
                    onChange={(e) => setOpponentWallet(e.target.value)}
                    placeholder="0x..."
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Wager Amount (USDC)</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  step="0.1"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  required
                />
              </div>

              {gameMode === 'lol' && !user?.riot_puuid && (
                <div className="alert alert-warning" style={{ marginTop: 16 }}>
                  You must <a href="/setup" style={{textDecoration: 'underline'}}>link your Riot Account</a> to issue LoL challenges.
                </div>
              )}
              <button
                type="submit"
                className={`btn btn-primary btn-full${creating ? ' btn-loading' : ''}`}
                disabled={creating || (gameMode === 'lol' ? (!gameName || !tagLine || !user?.riot_puuid) : !opponentWallet)}
              >
                {creating ? 'Creating...' : 'Send Challenge ⚔️'}
              </button>
            </form>
          </div>

          {/* Active Matches */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 className="heading">Your {gameMode === 'lol' ? 'Matches' : 'Challenges'}</h2>
              <button className="btn btn-ghost btn-sm" onClick={gameMode === 'lol' ? fetchMatches : fetchTttChallenges}>Refresh</button>
            </div>
            
            {loading ? (
              <div className="text-center text-muted" style={{ padding: 40 }}>Loading matches...</div>
            ) : gameMode === 'lol' && matches.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 16px' }}>
                <div className="empty-state-icon">🛡️</div>
                <div className="empty-state-title">No active matches</div>
                <p>Issue a challenge to get started.</p>
              </div>
            ) : gameMode === 'tictactoe' && tttChallenges.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 16px' }}>
                <div className="empty-state-icon">🛡️</div>
                <div className="empty-state-title">No active challenges</div>
                <p>Issue a challenge to get started.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {gameMode === 'lol' && matches.map(m => {
                  const isCreator = user?.user_id === m.player_a_id;
                  const opponentName = isCreator ? `${m.player_b_name}#${m.player_b_tag}` : `${m.player_a_name}#${m.player_a_tag}`;
                  
                  return (
                    <div 
                      key={m.match_id} 
                      className="card-hover"
                      style={{ 
                        background: 'var(--bg-input)', 
                        padding: 16, 
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        border: '1px solid var(--border-default)'
                      }}
                      onClick={() => navigate(`/match/${m.match_id}`)}
                    >
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>vs {opponentName}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span className="text-gold" style={{ fontSize: 13, fontWeight: 700 }}>{m.stake_amount} USDC</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>•</span>
                          <span className={`badge ${m.status === 'pending' ? 'badge-neutral' : m.status === 'active' ? 'badge-teal' : 'badge-purple'}`}>
                            {m.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>→</div>
                    </div>
                  );
                })}

                {gameMode === 'tictactoe' && tttChallenges.map(c => {
                  const opponentWallet = c.direction === 'outgoing' ? c.opponent_wallet : c.challenger_wallet;
                  const shortOpponent = `${opponentWallet.slice(0, 6)}...${opponentWallet.slice(-4)}`;
                  
                  return (
                    <div 
                      key={c.game_id} 
                      className="card-hover"
                      style={{ 
                        background: 'var(--bg-input)', 
                        padding: 16, 
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        border: '1px solid var(--border-default)'
                      }}
                      onClick={() => c.direction === 'outgoing' ? navigate(`/tictactoe/${c.game_id}`) : null}
                    >
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          {c.direction === 'outgoing' ? 'Challenged ' : 'Challenged by '} 
                          <span style={{ fontFamily: 'monospace' }}>{shortOpponent}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span className={`badge ${c.direction === 'outgoing' ? 'badge-neutral' : 'badge-gold'}`}>
                            {c.direction === 'outgoing' ? 'WAITING' : 'INCOMING'}
                          </span>
                        </div>
                      </div>
                      
                      {c.direction === 'incoming' ? (
                        <button 
                          className="btn btn-primary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAcceptTtt(c.game_id);
                          }}
                        >
                          Accept
                        </button>
                      ) : (
                        <div style={{ color: 'var(--text-muted)' }}>→</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
