import { useCallback, useEffect, useRef, useState } from 'react';

export type GeoStatus = 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable' | 'error';

export interface GeoFix {
  lat: number;
  lng: number;
  /** Metres as reported by the device. An estimate, never a guarantee. */
  accuracyMeters: number;
  /** Device timestamp of this fix (ms). */
  recordedAt: number;
  /** Wall-clock time we received it (ms). */
  receivedAt: number;
  heading: number | null;
  speed: number | null;
}

export interface GeoState {
  status: GeoStatus;
  fix: GeoFix | null;
  message: string | null;
  supported: boolean;
  secureContext: boolean;
}

function describeError(error: GeolocationPositionError): { status: GeoStatus; message: string } {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        status: 'denied',
        message:
          'Location is blocked. Enable location for this site in your browser settings, then try again.',
      };
    case error.POSITION_UNAVAILABLE:
      return {
        status: 'unavailable',
        message: 'No GPS fix available right now. Step outside or wait for a clear view of the sky.',
      };
    case error.TIMEOUT:
      return {
        status: 'error',
        message: 'Timed out waiting for a GPS fix. Move to an open area and retry.',
      };
    default:
      return { status: 'error', message: 'Could not read your location.' };
  }
}

/**
 * Real device geolocation only. Coordinates are always what the browser
 * reported — there is no mock or simulated fallback position. When the device
 * has no fix, `fix` stays null and the UI explains why.
 */
export function useGeolocation(enabled: boolean): GeoState & { request: () => void } {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const secureContext = typeof window === 'undefined' ? true : window.isSecureContext !== false;
  const [state, setState] = useState<GeoState>({
    status: 'idle',
    fix: null,
    message: supported ? null : 'This browser does not expose device location.',
    supported,
    secureContext,
  });
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null && supported) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, [supported]);

  const start = useCallback(() => {
    if (!supported) {
      setState((prev) => ({
        ...prev,
        status: 'unavailable',
        message: 'This browser does not expose device location.',
      }));
      return;
    }
    if (!secureContext) {
      setState((prev) => ({
        ...prev,
        status: 'unavailable',
        message: 'Location requires HTTPS. Open the secure (https://) link in Safari or Chrome.',
      }));
      return;
    }
    stop();
    setState((prev) => ({ ...prev, status: 'requesting', message: null }));
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setState((prev) => ({
          ...prev,
          status: 'watching',
          message: null,
          fix: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            recordedAt: position.timestamp || Date.now(),
            receivedAt: Date.now(),
            heading: Number.isFinite(position.coords.heading ?? Number.NaN)
              ? (position.coords.heading as number)
              : null,
            speed: Number.isFinite(position.coords.speed ?? Number.NaN)
              ? (position.coords.speed as number)
              : null,
          },
        }));
      },
      (error) => {
        const described = describeError(error);
        setState((prev) => ({ ...prev, status: described.status, message: described.message }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [secureContext, stop, supported]);

  useEffect(() => {
    if (!enabled) return;
    start();
    return stop;
  }, [enabled, start, stop]);

  return { ...state, request: start };
}
