import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { usePrivy } from '@privy-io/react-auth';
import { tictactoeAPI } from '../services/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import Sidebar from '../components/Sidebar';

export default function TicTacArena() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [game, setGame] = useState(null);
  const [socket, setSocket] = useState(null);
  const [error, setError] = useState(null);
  const [settlementTx, setSettlementTx] = useState(null);
  const [settlementConfirmed, setSettlementConfirmed] = useState(false);

  // M1: Track optimistic-move state so socket updates can't clobber a fresh
  // local move. `optimisticTsRef` is the timestamp of the last optimistic
  // mutation; `inFlightRef` is true while a makeMove call is awaiting the
  // server response. Socket updates older than the optimistic window are
  // ignored.
  const optimisticTsRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    // Initial fetch
    tictactoeAPI.getGame(id)
      .then(g => setGame(g))
      .catch(err => setError(err.response?.data?.error || err.message));

    if (!ready || !authenticated) return undefined;

    // Socket connect — token resolved on every (re)connect via async auth callback.
    const socketInstance = io(import.meta.env.VITE_API_URL || 'http://localhost:3001', {
      auth: async (cb) => {
        try {
          const token = await getAccessToken();
          cb({ token: token || '' });
        } catch (e) {
          cb({ token: '' });
        }
      },
    });
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      // join_game must wait for connection so the server-side auth has run.
      socketInstance.emit('join_game', id);
    });
    socketInstance.on('connect_error', (err) => {
      if (import.meta.env.DEV) console.warn('Game socket auth failed:', err?.message);
      setError('Cannot reach game server (auth). Try refreshing.');
    });

    socketInstance.on('game_update', (updatedGame) => {
      // Block socket replacement during the in-flight move window so a stale
      // pre-move broadcast can't overwrite our optimistic state.
      if (inFlightRef.current) return;
      // If the socket update was generated before our last optimistic write
      // (with a small 1s grace), drop it; the server's ack will reconcile.
      const updatedAtMs = updatedGame?.updated_at
        ? new Date(updatedGame.updated_at).getTime()
        : 0;
      if (updatedAtMs && updatedAtMs < optimisticTsRef.current - 1000) return;
      setGame(updatedGame);
    });

    socketInstance.on('settlement_pending', ({ txHash }) => {
      // Show the Basescan link immediately — tx is submitted but not yet mined
      setSettlementTx(txHash);
      setSettlementConfirmed(false);
    });

    socketInstance.on('settlement_success', ({ txHash }) => {
      if (import.meta.env.DEV) console.log('Prize confirmed on-chain!', txHash);
      setSettlementTx(txHash);
      setSettlementConfirmed(true);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [id, ready, authenticated, getAccessToken]);

  const handleCellClick = async (index) => {
    if (!game || game.status !== 'active') return;
    if (game.board[index] !== '-') return;

    const mySymbol = game.player_x_id === user?.user_id ? 'X' : (game.player_o_id === user?.user_id ? 'O' : null);
    if (game.turn !== mySymbol) return;
    if (inFlightRef.current) return;

    try {
      inFlightRef.current = true;
      optimisticTsRef.current = Date.now();
      // Optimistic update
      const newBoard = game.board.split('');
      newBoard[index] = mySymbol;
      setGame({ ...game, board: newBoard.join(''), turn: mySymbol === 'X' ? 'O' : 'X' });

      const serverGame = await tictactoeAPI.makeMove(id, index);
      // Reconcile fully with the authoritative server state.
      if (serverGame) setGame(serverGame);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      // Re-fetch to correct optimistic UI
      tictactoeAPI.getGame(id).then(g => setGame(g)).catch(() => {});
    } finally {
      inFlightRef.current = false;
    }
  };

  if (loading || !game) {
    return (
      <div className="app-layout">
        <Sidebar />
        <main className="main-content flex-center">
          <div className="loading-crown" style={{ animation: 'pulse 1.5s infinite' }}>⚔️</div>
          <p>Loading Arena...</p>
        </main>
      </div>
    );
  }

  const mySymbol = game.player_x_id === user?.user_id ? 'X' : (game.player_o_id === user?.user_id ? 'O' : 'Spectator');
  const isMyTurn = game.status === 'active' && game.turn === mySymbol;

  let statusText = '';
  let statusColor = 'var(--text-primary)';
  
  if (game.status === 'active') {
    statusText = isMyTurn ? 'YOUR TURN' : 'OPPONENT\'S TURN';
    statusColor = isMyTurn ? 'var(--teal)' : 'var(--text-muted)';
  } else if (game.status === 'pending') {
    statusText = 'WAITING FOR OPPONENT TO ACCEPT...';
    statusColor = 'var(--gold)';
  } else if (game.status === 'won_x') {
    statusText = mySymbol === 'X' ? 'YOU WON THE BOUNTY!' : 'YOU LOST';
    statusColor = mySymbol === 'X' ? 'var(--gold)' : 'var(--danger)';
  } else if (game.status === 'won_o') {
    statusText = mySymbol === 'O' ? 'YOU WON THE BOUNTY!' : 'YOU LOST';
    statusColor = mySymbol === 'O' ? 'var(--gold)' : 'var(--danger)';
  } else if (game.status === 'draw') {
    statusText = 'DRAW';
    statusColor = 'var(--text-muted)';
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 className="page-title" style={{ marginTop: '2rem' }}>Tic Tac Toe Arena</h1>
        
        {game.tournament_id && (
          <div className="badge badge-purple" style={{ marginBottom: 16 }}>Tournament Match</div>
        )}
        
        <div style={{ fontSize: 24, fontWeight: 'bold', color: statusColor, marginBottom: 32, letterSpacing: '1px' }}>
          {statusText}
        </div>

        {error && (
          <div className="alert alert-danger" style={{ marginBottom: 20 }}>{error}</div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 100px)',
          gridTemplateRows: 'repeat(3, 100px)',
          gap: 8,
          background: 'var(--border-default)',
          padding: 8,
          borderRadius: 12
        }}>
          {game.board.split('').map((cell, idx) => {
            const row = Math.floor(idx / 3);
            const col = idx % 3;
            const cellState = cell === '-' ? 'empty' : cell;
            const interactive = isMyTurn && cell === '-';
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleCellClick(idx)}
                disabled={!interactive}
                aria-label={`cell ${row} ${col}, ${cellState}`}
                style={{
                  background: 'var(--bg-card)',
                  border: 'none',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 48,
                  fontWeight: 'bold',
                  color: cell === 'X' ? 'var(--gold)' : (cell === 'O' ? 'var(--purple-light)' : 'transparent'),
                  cursor: interactive ? 'pointer' : 'default',
                  transition: 'all 0.2s',
                  boxShadow: interactive ? 'inset 0 0 10px rgba(255,255,255,0.05)' : 'none',
                  padding: 0,
                }}
                className={interactive ? 'hover-glow' : ''}
              >
                {cell === '-' ? '' : cell}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 40, display: 'flex', gap: 20 }}>
          <div className="card" style={{ padding: '16px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Player X</div>
            <div style={{ fontSize: 18, color: 'var(--gold)', fontWeight: 'bold' }}>
              {game.player_x_id === user?.user_id ? 'You' : 'Opponent'}
            </div>
          </div>
          <div className="card" style={{ padding: '16px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Player O</div>
            <div style={{ fontSize: 18, color: 'var(--purple-light)', fontWeight: 'bold' }}>
              {game.player_o_id === user?.user_id ? 'You' : 'Opponent'}
            </div>
          </div>
        </div>

        {(game.status === 'won_x' || game.status === 'won_o' || game.status === 'draw') && (
          <div style={{ marginTop: 32, textAlign: 'center', animation: 'fadeIn 0.5s' }}>
            {(game.tournament_id || game.match_id) ? (
              settlementTx ? (
                <div className="alert alert-success" style={{ marginBottom: 16, display: 'inline-block', textAlign: 'left' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                    {settlementConfirmed ? '🏆 Prize Confirmed On-Chain!' : '⏳ Prize Transaction Submitted...'}
                  </div>
                  <a href={`https://sepolia.basescan.org/tx/${settlementTx}`} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', textDecoration: 'underline', fontSize: 14 }}>
                    {settlementConfirmed ? 'View Receipt on Basescan ↗' : 'Track on Basescan ↗'}
                  </a>
                </div>
              ) : game.status !== 'draw' ? (
                <div className="text-muted" style={{ marginBottom: 16, fontSize: 14 }}>
                  Settling smart contract prize... ⏳
                </div>
              ) : null
            ) : (
              <div className="text-muted" style={{ marginBottom: 16, fontSize: 14 }}>
                Game Over! 🤝
              </div>
            )}
            <div>
              <button className="btn btn-secondary" onClick={() => navigate('/challenge')}>
                Return to Lobby
              </button>
            </div>
          </div>
        )}
      </main>

      <style>{`
        .hover-glow:hover {
          background: rgba(255,255,255,0.1) !important;
        }
      `}</style>
    </div>
  );
}
