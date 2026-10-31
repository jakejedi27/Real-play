import { Link, useNavigate, useParams } from 'react-router-dom';
import { GameSessionProvider, useGameSession } from '../lib/GameSession';
import { Lobby } from '../components/Lobby';
import { LiveGame } from '../components/LiveGame';
import { Results } from '../components/Results';
import { Banner, EmptyState, Spinner } from '../components/ui';

function Screen() {
  const session = useGameSession();
  const snapshot = session.snapshot;

  if (session.loading) {
    return (
      <div className="shell narrow">
        <Spinner label="Loading the game…" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="shell narrow">
        <EmptyState
          glyph="🔒"
          title="No session on this device"
          action={
            <Link to="/join" className="btn btn-primary">
              Join with a code
            </Link>
          }
        >
          {session.error ??
            'This device does not hold a player session for that game. Join with the game code and your nickname to get back in.'}
        </EmptyState>
      </div>
    );
  }

  if (snapshot.game.status === 'ended' || snapshot.game.status === 'cancelled') {
    return <Results snapshot={snapshot} />;
  }

  if (snapshot.game.status === 'lobby') {
    return (
      <div className="shell">
        <Lobby snapshot={snapshot} />
      </div>
    );
  }

  return (
    <div className="shell wide">
      {session.connection === 'reconnecting' ? (
        <Banner tone="warn" title="Reconnecting">
          The live link dropped. RealPlay is polling the server until the stream comes back — the
          match keeps running.
        </Banner>
      ) : null}
      <LiveGame snapshot={snapshot} />
    </div>
  );
}

export function GameScreen() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();

  if (!gameId) {
    return (
      <div className="shell narrow">
        <EmptyState glyph="✕" title="Missing game id" action={<Link to="/" className="btn btn-primary">Home</Link>}>
          Open the game from your history or join with a code.
        </EmptyState>
      </div>
    );
  }

  return (
    <GameSessionProvider gameId={gameId} onSessionLost={() => navigate('/join', { replace: true })}>
      <Screen />
    </GameSessionProvider>
  );
}
