import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MODE_META, MODE_LIST } from '@shared/modes';
import { defaultSettings, validateSettings } from '@shared/settings';
import type { ModeId, ModeSettings } from '@shared/types';
import { api, saveSession } from '../lib/api';
import { SettingsEditor, SettingsSummary } from '../components/SettingsEditor';
import { Banner, Field, Pill, TextInput } from '../components/ui';

const MODE_IDS = MODE_LIST.map((mode) => mode.id);

function isModeId(value: string | undefined): value is ModeId {
  return Boolean(value) && MODE_IDS.includes(value as ModeId);
}

const NICKNAME_KEY = 'realplay.nickname.v1';

type Step = 'basics' | 'rules' | 'review';
const STEP_ORDER: Step[] = ['basics', 'rules', 'review'];

export function Wizard() {
  const params = useParams<{ mode: string }>();
  const navigate = useNavigate();
  const mode: ModeId = isModeId(params.mode) ? params.mode : 'manhunt';
  const meta = MODE_META[mode];

  const [step, setStep] = useState<Step>('basics');
  const [modeChoice, setModeChoice] = useState<ModeId>(mode);
  const [name, setName] = useState(`${MODE_META[mode].name} night`);
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem(NICKNAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [settings, setSettings] = useState<ModeSettings>(() => defaultSettings(mode));
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const validation = useMemo(() => validateSettings(settings), [settings]);

  const switchMode = (next: ModeId) => {
    if (next === modeChoice) return;
    setModeChoice(next);
    setSettings(defaultSettings(next));
    setName((current) => {
      const previousDefault = `${MODE_META[modeChoice].name} night`;
      return current === previousDefault || current.trim().length === 0
        ? `${MODE_META[next].name} night`
        : current;
    });
  };

  const basicsProblem =
    name.trim().length < 3
      ? 'Give the game a name of at least 3 characters.'
      : nickname.trim().length < 2
        ? 'Add the nickname other players will see (2+ characters).'
        : null;

  const canReview = !basicsProblem && validation.errors.length === 0;

  const create = async () => {
    if (basicsProblem) {
      setStep('basics');
      setError(basicsProblem);
      return;
    }
    if (validation.errors.length > 0) {
      setStep('rules');
      setError('Fix the rule conflicts before creating the game.');
      setDetails(validation.errors);
      return;
    }
    setBusy(true);
    setError(null);
    setDetails([]);
    try {
      const result = await api.createGame({
        mode: settings.mode,
        name: name.trim(),
        nickname: nickname.trim(),
        settings,
      });
      try {
        localStorage.setItem(NICKNAME_KEY, nickname.trim());
      } catch {
        /* private mode */
      }
      saveSession({
        gameId: result.snapshot.game.id,
        code: result.snapshot.game.code,
        mode: result.snapshot.game.mode,
        name: result.snapshot.game.name,
        token: result.token,
        playerId: result.snapshot.you.id,
        nickname: result.snapshot.you.nickname,
        isHost: true,
      });
      navigate(`/game/${result.snapshot.game.id}`, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The game could not be created.');
      if (caught && typeof caught === 'object' && 'details' in caught) {
        const raw = (caught as { details?: unknown }).details;
        if (Array.isArray(raw)) setDetails(raw.map(String));
      }
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="shell">
      <header className="screen-head">
        <Link to="/" className="back-link">
          ← Home
        </Link>
        <h1>Set up {meta.name}</h1>
        <p className="muted">{meta.tagline} Rules are saved on the server and cannot be changed once play starts.</p>
      </header>

      <ol className="steps" aria-label="Setup progress">
        {STEP_ORDER.map((entry, index) => (
          <li
            key={entry}
            className={`step${entry === step ? ' step-current' : ''}${index < stepIndex ? ' step-done' : ''}`}
          >
            <span className="step-dot">{index < stepIndex ? '✓' : index + 1}</span>
            <span className="step-label">
              {entry === 'basics' ? 'Basics' : entry === 'rules' ? 'Rules' : 'Review'}
            </span>
          </li>
        ))}
      </ol>

      {error ? (
        <Banner tone="danger" title="Not ready yet">
          {error}
          {details.length > 0 ? (
            <ul className="banner-list">
              {details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </Banner>
      ) : null}

      {step === 'basics' ? (
        <div className="card">
          <h2 className="card-title">Which game are you running?</h2>
          <div className="mode-picker">
            {MODE_LIST.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`mode-choice${entry.id === modeChoice ? ' selected' : ''}`}
                style={{ '--mode-accent': entry.accent } as React.CSSProperties}
                onClick={() => switchMode(entry.id)}
                aria-pressed={entry.id === modeChoice}
              >
                <span className="mode-choice-glyph" aria-hidden="true">
                  {entry.glyph}
                </span>
                <strong>{entry.name}</strong>
                <em>{entry.tagline}</em>
              </button>
            ))}
          </div>

          <div className="divider" />

          <Field
            label="Game name"
            hint="Shown on the lobby, the join screen and in history."
            error={name.trim().length < 3 ? 'At least 3 characters.' : undefined}
          >
            <TextInput value={name} onChange={setName} placeholder="Saturday manhunt" maxLength={40} />
          </Field>

          <Field
            label="Your nickname (host)"
            hint="Other players see this. RealPlay never needs your real name."
            error={nickname.trim().length < 2 ? 'At least 2 characters.' : undefined}
          >
            <TextInput value={nickname} onChange={setNickname} placeholder="e.g. Alex" maxLength={20} />
          </Field>

          <div className="wizard-actions">
            <Link to="/" className="btn btn-ghost">
              Cancel
            </Link>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(basicsProblem)}
              onClick={() => {
                setError(null);
                setStep('rules');
              }}
            >
              Configure rules →
            </button>
          </div>
        </div>
      ) : null}

      {step === 'rules' ? (
        <>
          <div className="rules-banner">
            <div>
              <strong>{meta.name} rules</strong>
              <p className="muted">
                Defaults are playable as-is. Change anything you like — the server enforces what you
                save.
              </p>
            </div>
            <div className="rules-banner-tags">
              <Pill>{settings.maxPlayers} max</Pill>
              <Pill>{settings.durationMinutes} min</Pill>
            </div>
          </div>

          {validation.errors.length > 0 ? (
            <Banner tone="danger" title="Conflicting rules">
              <ul className="banner-list">
                {validation.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Banner>
          ) : null}
          {validation.warnings.length > 0 ? (
            <Banner tone="warn" title="Worth checking">
              <ul className="banner-list">
                {validation.warnings.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Banner>
          ) : null}

          <SettingsEditor settings={settings} onChange={setSettings} />

          <div className="wizard-actions sticky">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('basics')}>
              ← Basics
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canReview}
              onClick={() => {
                setError(null);
                setStep('review');
              }}
            >
              Review game →
            </button>
          </div>
        </>
      ) : null}

      {step === 'review' ? (
        <>
          <div className="card" style={{ '--mode-accent': meta.accent } as React.CSSProperties}>
            <div className="review-head">
              <span className="mode-glyph" aria-hidden="true">
                {meta.glyph}
              </span>
              <div>
                <h2>{name.trim()}</h2>
                <p className="muted">
                  {meta.name} · hosted by {nickname.trim()}
                </p>
              </div>
            </div>
            <SettingsSummary settings={settings} center={settings.area.center} />
            <p className="field-hint">
              When you create the game you become host. You can still edit these rules in the lobby
              until the countdown starts.
            </p>
          </div>

          {validation.errors.length > 0 ? (
            <Banner tone="danger" title="Fix these first">
              <ul className="banner-list">
                {validation.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Banner>
          ) : null}

          <div className="wizard-actions sticky">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('rules')} disabled={busy}>
              ← Rules
            </button>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={!canReview || busy}
              onClick={() => void create()}
            >
              {busy ? 'Creating…' : 'Create game'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
