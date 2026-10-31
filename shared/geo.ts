import type { LatLng, PlayArea } from './types';

const EARTH_RADIUS_M = 6371008.8;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in meters between two coordinates. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInsideArea(point: LatLng, area: PlayArea): boolean {
  if (!area.enabled) return true;
  if (!area.center) return false;
  return distanceMeters(point, area.center) <= area.radiusMeters;
}

export function isValidLatLng(v: unknown): v is LatLng {
  if (!v || typeof v !== 'object') return false;
  const { lat, lng } = v as LatLng;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Move a point by meters on a bearing (used only for default base placement). */
export function offsetLatLng(origin: LatLng, northMeters: number, eastMeters: number): LatLng {
  const lat = origin.lat + northMeters / 111_320;
  const lng = origin.lng + eastMeters / (111_320 * Math.cos(toRad(origin.lat)) || 1);
  return { lat, lng };
}

export function pointOnCircle(center: LatLng, radiusMeters: number, bearingDeg: number): LatLng {
  const bearing = toRad(bearingDeg);
  return {
    lat: center.lat + (radiusMeters * Math.cos(bearing)) / 111_320,
    lng:
      center.lng +
      (radiusMeters * Math.sin(bearing)) / (111_320 * Math.cos(toRad(center.lat)) || 1),
  };
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Reported GPS accuracy is an estimate, never a guarantee. */
export function accuracyLabel(accuracyMeters: number): string {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 'unknown accuracy';
  if (accuracyMeters <= 10) return `±${Math.round(accuracyMeters)} m (good)`;
  if (accuracyMeters <= 30) return `±${Math.round(accuracyMeters)} m (fair)`;
  if (accuracyMeters <= 100) return `±${Math.round(accuracyMeters)} m (weak)`;
  return `±${Math.round(accuracyMeters)} m (very weak)`;
}

export function ageSeconds(recordedAt: number, now: number): number {
  return Math.max(0, Math.round((now - recordedAt) / 1000));
}
