import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Home } from './screens/Home';
import { Wizard } from './screens/Wizard';
import { Join } from './screens/Join';
import { GameScreen } from './screens/GameScreen';
import { History } from './screens/History';
import { Safety } from './screens/Safety';
import { EmptyState } from './components/ui';

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="shell">
      <EmptyState
        glyph="✕"
        title="Page not found"
        action={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
            Back to home
          </button>
        }
      >
        That link does not match a screen in RealPlay.
      </EmptyState>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create/:mode" element={<Wizard />} />
        <Route path="/join" element={<Join />} />
        <Route path="/game/:gameId" element={<GameScreen />} />
        <Route path="/history" element={<History />} />
        <Route path="/safety" element={<Safety />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
