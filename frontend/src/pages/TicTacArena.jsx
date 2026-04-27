import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { tictactoeAPI } from '../services/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import Sidebar from '../components/Sidebar';

export default function TicTacArena() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  
  const [game, setGame] = useState(null);
  const [socket, setSocket] = useState(null);
  const [error, setError] = useState(null);
  const [settlementTx, setSettlementTx] = useState(null);
  const [settlementConfirmed, setSettlementConfirmed] = useState(false);

  useEffect(() => {
    // Initial fetch
    tictactoeAPI.getGame(id)
      .then(g => setGame(g))
      .catch(err => setError(err.response?.data?.error || err.message));

    // Socket connect
    const socketInstance = io(import.meta.env.VITE_API_URL || 'http://localhost:3001');
    setSocket(socketInstance);

    socketInstance.emit('join_game', id);

    socketInstance.on('game_update', (updatedGame) => {
      setGame(updatedGame);
    });

    socketInstance.on('settlement_pending', ({ txHash }) => {
      // Show the Basescan link immediately — tx is submitted but not yet mined
      setSettlementTx(txHash);
      setSettlementConfirmed(false);
    });

    socketInstance.on('settlement_success', ({ txHash }) => {
      console.log('Prize confirmed on-chain!', txHash);
      setSettlementTx(txHash);
      setSettlementConfirmed(true);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [id]);

  const handleCellClick = async (index) => {
    if (!game || game.status !== 'active') return;
    if (game.board[index] !== '-') return;

    const mySymbol = game.player_x_id === user?.user_id ? 'X' : (game.player_o_id === user?.user_id ? 'O' : null);
    if (game.turn !== mySymbol) return;

    try {
      // Optimistic update
      const newBoard = game.board.split('');
      newBoard[index] = mySymbol;
      setGame({ ...game, board: newBoard.join(''), turn: mySymbol === 'X' ? 'O' : 'X' });
      
      await tictactoeAPI.makeMove(id, index);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      // Re-fetch to correct optimistic UI
      tictactoeAPI.getGame(id).then(g => setGame(g));
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
          {game.board.split('').map((cell, idx) => (
            <div
              key={idx}
              onClick={() => handleCellClick(idx)}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 48,
                fontWeight: 'bold',
                color: cell === 'X' ? 'var(--gold)' : (cell === 'O' ? 'var(--purple-light)' : 'transparent'),
                cursor: (isMyTurn && cell === '-') ? 'pointer' : 'default',
                transition: 'all 0.2s',
                boxShadow: (isMyTurn && cell === '-') ? 'inset 0 0 10px rgba(255,255,255,0.05)' : 'none'
              }}
              className={(isMyTurn && cell === '-') ? 'hover-glow' : ''}
            >
              {cell === '-' ? '' : cell}
            </div>
          ))}
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
            {settlementTx ? (
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
            ) : null}
            <div>
              <button className="btn btn-secondary" onClick={() => navigate('/tournaments')}>
                Return to Tournaments
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
