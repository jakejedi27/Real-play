import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { useGeolocation, type GeoState } from './useGeolocation';

export interface UplinkState {
  geo: GeoState & { request: () => void };
  lastSentAt: number | null;
  sending: boolean;
  sendError: string | null;
  sendNow: () => void;
  /** True when the last attempt was blocked because the fix is older than the stale window. */
  throttledUntil: number | null;
}

/**
 * Streams real device fixes to the server at most once every `minIntervalSeconds`.
 * Nothing is ever sent without a genuine fix from the geolocation API.
 */
export function useLocationUplink(options: {
  gameId: string;
  token: string | null;
  enabled: boolean;
  minIntervalSeconds: number;
  staleAfterSeconds: number;
  onSent?: () => void;
}): UplinkState {
  const { gameId, token, enabled, minIntervalSeconds, staleAfterSeconds, onSent } = options;
  const geo = useGeolocation(enabled);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [throttledUntil, setThrottledUntil] = useState<number | null>(null);
  const lastAttemptRef = useRef(0);
  const inFlightRef = useRef(false);
  const fixRef = useRef(geo.fix);
  fixRef.current = geo.fix;

  const send = useCallback(
    async (force: boolean) => {
      const fix = fixRef.current;
      if (!token || !fix || inFlightRef.current) return;
      const now = Date.now();
      if (!force && now - lastAttemptRef.current < Math.max(minIntervalSeconds, 5) * 1000) return;
      if (now - fix.recordedAt > staleAfterSeconds * 1000 && !force) {
        setThrottledUntil(now + 30_000);
        return;
      }
      lastAttemptRef.current = now;
      inFlightRef.current = true;
      setSending(true);
      setSendError(null);
      try {
        await api.location(gameId, token, {
          lat: fix.lat,
          lng: fix.lng,
          accuracyMeters: fix.accuracyMeters,
          recordedAt: fix.recordedAt,
        });
        setLastSentAt(Date.now());
        setThrottledUntil(null);
        onSent?.();
      } catch (error) {
        setSendError(error instanceof ApiError ? error.message : 'Location could not be sent.');
      } finally {
        inFlightRef.current = false;
        setSending(false);
      }
    },
    [gameId, minIntervalSeconds, onSent, staleAfterSeconds, token],
  );

  /* Every new fix is a candidate for upload; throttling keeps the radio quiet. */
  useEffect(() => {
    if (!enabled || !geo.fix) return;
    void send(false);
  }, [enabled, geo.fix, send]);

  const sendNow = useCallback(() => {
    void send(true);
  }, [send]);

  return { geo, lastSentAt, sending, sendError, sendNow, throttledUntil };
}
