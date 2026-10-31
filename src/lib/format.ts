export function formatClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '--:--';
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDurationText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function ageText(ageSeconds: number): string {
  if (ageSeconds < 5) return 'just now';
  if (ageSeconds < 60) return `${Math.round(ageSeconds)}s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function accuracyText(meters: number): string {
  if (!Number.isFinite(meters)) return 'accuracy unknown';
  if (meters < 1) return '±<1 m';
  return `±${Math.round(meters)} m`;
}

export function clockTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dateText(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function dateTimeText(ts: number | null | undefined): string {
  if (!ts) return '—';
  return `${dateText(ts)} · ${clockTime(ts)}`;
}

export function normaliseCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
}
