import { Link } from 'react-router-dom';

const RULES: { title: string; body: string }[] = [
  {
    title: 'Agree boundaries before the start',
    body: 'Hosts set a play area in the wizard. Walk the edge with your team if the area is new to anyone. Anything that looks private property is out of play, even inside the circle.',
  },
  {
    title: 'No trespassing, ever',
    body: 'A garden, a yard, a farm track, a building site — if you would not walk there without the game, do not walk there with it. Respawn or reroute instead.',
  },
  {
    title: 'Traffic comes first',
    body: 'Never sprint across a road, never follow someone into traffic, and never chase on a bike through moving cars. If a runner reaches a road, the chase stops there.',
  },
  {
    title: 'No phones while driving',
    body: 'Manhunt hunter transport rules exist because a driver reading a map or a reveal is a hazard. Park before you check the app. Passengers only.',
  },
  {
    title: 'Stop play when it stops being fun',
    body: 'Anyone can call a stop, and the host ends the game. Exhaustion, heat, cold, darkness, a stranger who is uncomfortable — all valid reasons.',
  },
  {
    title: 'Respect people who are not playing',
    body: 'Sprinting through a quiet street at night is intimidating. Keep voices down, do not hide in someone’s porch, and explain the game if asked.',
  },
];

export function Safety() {
  return (
    <div className="shell narrow">
      <header className="screen-head">
        <Link to="/" className="back-link">
          ← Home
        </Link>
        <h1>Safety &amp; privacy</h1>
        <p className="muted">RealPlay is a real-world game. These are non-negotiable.</p>
      </header>

      <div className="card">
        <h2 className="card-title">Outdoor play rules</h2>
        <ol className="rules">
          {RULES.map((rule) => (
            <li key={rule.title}>
              <strong>{rule.title}</strong>
              <p>{rule.body}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h2 className="card-title">Location &amp; data</h2>
        <ul className="bullets">
          <li>
            Positions come only from the browser’s geolocation API. RealPlay never invents,
            interpolates or simulates a position, and it never claims better accuracy than the
            device reports.
          </li>
          <li>
            Accuracy, the time of the fix and its age are always shown. Fixes older than the
            configured window are labelled stale and are ignored by scoring.
          </li>
          <li>
            In Manhunt, hunters never receive a runner’s live position. At each scheduled reveal the
            server sends the last valid recorded fix, with its timestamp, age and accuracy.
          </li>
          <li>
            Location data stays on the server hosting your game. The map tiles you load come from
            OpenStreetMap, which sees the tile requests your browser makes.
          </li>
          <li>
            Nicknames only. RealPlay does not ask for, or need, your real name or address.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2 className="card-title">Emergency</h2>
        <p className="muted">
          RealPlay has no emergency features and no live location sharing between teams beyond the
          rules you configure. If someone is hurt or missing, stop the game and call your local
          emergency number.
        </p>
        <p>
          <Link to="/" className="link-more">
            Back to games →
          </Link>
        </p>
      </div>
    </div>
  );
}
