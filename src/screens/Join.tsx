import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MODE_META } from '@shared/modes';
import { api, saveSession, type PreviewResponse } from '../lib/api';
import { normaliseCode } from '../lib/format';
import { Banner, Field, Pill, Spinner, TextInput } from '../components/ui';

const NICKNAME_KEY = 'realplay.nickname.v1';

export function Join() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const codeParam = normaliseCode(params.get('code') ?? '');
  const [code, setCode] = useState(codeParam);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem(NICKNAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookUp = useCallback(
    async (raw: string) => {
      const cleaned = normaliseCode(raw);
      if (cleaned.length !== 6) {
        setPreview(null);
        setPreviewState('idle');
        setPreviewError(cleaned.length > 0 ? 'Codes are exactly 6 characters.' : null);
        return;
      }
      setPreviewState('loading');
      setPreviewError(null);
      try {
        const result = await api.preview(cleaned);
        setPreview(result);
        setPreviewState('idle');
        setParams({ code: result.code }, { replace: true });
      } catch (caught) {
        setPreview(null);
        setPreviewState('error');
        setPreviewError(caught instanceof Error ? caught.message : 'That code did not match a game.');
      }
    },
    [setParams],
  );

  useEffect(() => {
    if (codeParam.length === 6) void lookUp(codeParam);
    // Only run for the initial code in the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!preview) return;
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      setError('Pick a nickname with at least 2 characters.');
      return;
    }
    if (preview.requiresConsent && !consent) {
      setError('This mode needs your location, so consent is required before joining.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.join({
        code: preview.code,
        nickname: trimmed,
        consentLocation: preview.requiresConsent ? consent : consent,
      });
      try {
        localStorage.setItem(NICKNAME_KEY, trimmed);
      } catch {
        /* private mode */
      }
      saveSession({
        gameId: result.gameId,
        code: preview.code,
        mode: result.snapshot.game.mode,
        name: result.snapshot.game.name,
        token: result.token,
        playerId: result.playerId,
        nickname: trimmed,
        isHost: result.snapshot.you.isHost,
      });
      navigate(`/game/${result.gameId}`, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not join that game.');
    } finally {
      setBusy(false);
    }
  };

  const meta = preview ? MODE_META[preview.mode] : null;

  return (
    <div className="shell narrow">
      <header className="screen-head">
        <Link to="/" className="back-link">
          ← Home
        </Link>
        <h1>Join a game</h1>
        <p className="muted">Enter the six-character code from your host. No account required.</p>
      </header>

      <div className="card">
        <Field
          label="Game code"
          hint="Letters and numbers. Not case sensitive."
          error={previewError ?? undefined}
        >
          <TextInput
            value={code}
            onChange={(value) => {
              const cleaned = normaliseCode(value).slice(0, 6);
              setCode(cleaned);
              if (cleaned.length === 6) void lookUp(cleaned);
              else {
                setPreview(null);
                setPreviewError(null);
              }
            }}
            placeholder="AB12CD"
            maxLength={6}
            autoCapitalize="characters"
          />
        </Field>

        {previewState === 'loading' ? <Spinner label="Looking up the game…" /> : null}

        {preview && meta ? (
          <div className="join-preview" style={{ '--mode-accent': meta.accent } as React.CSSProperties}>
            <div className="join-preview-head">
              <span className="mode-glyph small" aria-hidden="true">
                {meta.glyph}
              </span>
              <div>
                <h2>{preview.name}</h2>
                <p className="muted">
                  {meta.name} · hosted by {preview.hostNickname}
                </p>
              </div>
            </div>
            <div className="join-preview-meta">
              <Pill tone={preview.status === 'lobby' ? 'live' : 'neutral'}>{preview.status}</Pill>
              <Pill>
                {preview.playerCount}/{preview.maxPlayers} players
              </Pill>
              {preview.requiresConsent ? <Pill tone="warn">Location required</Pill> : null}
            </div>
            {preview.playerCount >= preview.maxPlayers ? (
              <Banner tone="danger" title="Game is full">
                This lobby has reached its player limit. Ask the host to raise it.
              </Banner>
            ) : null}
          </div>
        ) : null}

        <div className="divider" />

        <Field label="Nickname" hint="Shown to other players. A first name or handle is fine.">
          <TextInput
            value={nickname}
            onChange={setNickname}
            placeholder="e.g. Sam"
            maxLength={20}
            autoCapitalize="words"
          />
        </Field>

        {preview?.requiresConsent ? (
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              <strong>I agree to share my device location with this game.</strong>
              <em>
                Positions are stored on the game server for the duration of play. Other players only
                see yours when the rules allow it. You can stop sharing by leaving the game.
              </em>
            </span>
          </label>
        ) : (
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              <strong>Share my location with my team when I turn it on.</strong>
              <em>Optional for this mode. Nothing is uploaded until you send a fix.</em>
            </span>
          </label>
        )}

        {error ? (
          <Banner tone="danger" title="Could not join">
            {error}
          </Banner>
        ) : null}

        <button
          type="button"
          className="btn btn-primary btn-block btn-lg"
          disabled={!preview || busy || (preview?.playerCount ?? 0) >= (preview?.maxPlayers ?? 1)}
          onClick={() => void submit()}
        >
          {busy ? 'Joining…' : preview ? `Join ${preview.name}` : 'Enter a code first'}
        </button>

        <p className="field-hint">
          By joining you agree to the safety rules: stay off private property, watch for traffic, and
          stop if anyone is at risk. <Link to="/safety">Read the safety guidance</Link>.
        </p>
      </div>
    </div>
  );
}
