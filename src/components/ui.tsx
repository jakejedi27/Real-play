import type { ChangeEvent, ReactNode } from 'react';

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className={`field${error ? ' field-error' : ''}`} htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-hint field-hint-error">{error}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  id,
  inputMode,
  autoCapitalize,
  spellCheck,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  id?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  autoCapitalize?: 'none' | 'characters' | 'sentences' | 'words';
  spellCheck?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      className="input"
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      inputMode={inputMode}
      autoCapitalize={autoCapitalize}
      spellCheck={spellCheck}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  error,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  error?: string;
  suffix?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <div className="number-row">
        <button
          type="button"
          className="stepper"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(clampNumber(value - step, min, max))}
        >
          −
        </button>
        <div className="number-value">
          <input
            className="number-input"
            type="number"
            inputMode="decimal"
            value={Number.isFinite(value) ? value : min}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange(Number.isFinite(next) ? clampNumber(next, min, max) : min);
            }}
          />
          {suffix ? <span className="number-suffix">{suffix}</span> : null}
        </div>
        <button
          type="button"
          className="stepper"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(clampNumber(value + step, min, max))}
        >
          +
        </button>
      </div>
    </Field>
  );
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <div className="toggle-copy">
        <span className="field-label">{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`toggle${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : null}
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`segmented-btn${option.value === value ? ' is-active' : ''}`}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {option.hint ? <em>{option.hint}</em> : null}
          </button>
        ))}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'live' | 'warn' | 'danger' | 'good';
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Banner({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'good';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="banner-body">
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
      {action ? <div className="banner-action">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? 'Loading…'}</span>
    </div>
  );
}

export function EmptyState({
  glyph,
  title,
  children,
  action,
}: {
  glyph?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {glyph ? (
        <div className="empty-glyph" aria-hidden="true">
          {glyph}
        </div>
      ) : null}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="section-sub">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
