import { useState } from 'react';
import type { LatLng } from '@shared/types';
import { accuracyText, clockTime } from '../lib/format';

export interface CapturedFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
  recordedAt: number;
}

export function captureCurrentPosition(): Promise<CapturedFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('This browser does not expose device location.'));
      return;
    }
    if (window.isSecureContext === false) {
      reject(new Error('Location requires HTTPS. Open the secure link in Safari or Chrome.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          recordedAt: position.timestamp || Date.now(),
        });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. Allow it in your browser settings to use real positions.'
            : error.code === error.POSITION_UNAVAILABLE
              ? 'No GPS fix right now. Step outside and try again.'
              : 'Timed out waiting for a GPS fix.';
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/**
 * Captures a genuine device fix on demand. There is deliberately no manual
 * coordinate entry and no fallback position: if the device cannot report a
 * location, the host is told why instead of being given a made-up point.
 */
export function LocationCapture({
  label = 'Use my current location',
  onCapture,
  value,
  disabled,
  compact,
}: {
  label?: string;
  onCapture: (fix: CapturedFix) => void;
  value?: LatLng | null;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);

  const grab = async () => {
    setState('busy');
    setMessage(null);
    try {
      const fix = await captureCurrentPosition();
      setLastAccuracy(fix.accuracyMeters);
      setLastAt(fix.recordedAt);
      setState('idle');
      onCapture(fix);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Could not read your location.');
    }
  };

  return (
    <div className={`capture${compact ? ' capture-compact' : ''}`}>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        onClick={() => void grab()}
        disabled={disabled || state === 'busy'}
      >
        <span aria-hidden="true">◎</span>
        {state === 'busy' ? 'Getting GPS fix…' : label}
      </button>
      {value ? (
        <span className="capture-meta">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          {lastAccuracy !== null ? ` · ${accuracyText(lastAccuracy)}` : ''}
          {lastAt !== null ? ` · ${clockTime(lastAt)}` : ''}
        </span>
      ) : (
        <span className="capture-meta muted">No position captured yet</span>
      )}
      {message ? (
        <span className="capture-meta capture-error" role="alert">
          {message}
        </span>
      ) : null}
    </div>
  );
}
