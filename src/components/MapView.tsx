import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, PlayArea } from '@shared/types';

const TILE_URL =
  (import.meta.env.VITE_TILE_URL as string | undefined) ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_TILE_ATTRIBUTION as string | undefined) ??
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string;
  /** Filled pins are live positions; hollow pins are historical/revealed. */
  fill?: boolean;
  radius?: number;
  sublabel?: string;
}

export interface MapRing {
  id: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  color: string;
  label?: string;
  dashed?: boolean;
}

function Recenter({
  center,
  recenterKey,
  zoom,
}: {
  center: LatLng;
  recenterKey: number;
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lng], zoom, { duration: 0.6 });
  }, [center.lat, center.lng, map, recenterKey, zoom]);
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 220);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

export function MapView({
  center,
  zoom = 16,
  accuracyMeters,
  area,
  pins = [],
  rings = [],
  recenterKey = 0,
  interactive = true,
  className = 'map',
}: {
  center: LatLng | null;
  zoom?: number;
  accuracyMeters?: number | null;
  area?: PlayArea | null;
  pins?: MapPin[];
  rings?: MapRing[];
  recenterKey?: number;
  interactive?: boolean;
  className?: string;
}) {
  const mapCenter: [number, number] = center ? [center.lat, center.lng] : [20, 0];
  const mapZoom = zoom ?? (center ? 16 : 2);

  return (
    <div className={className}>
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        scrollWheelZoom={false}
        dragging={interactive}
        touchZoom={interactive}
        doubleClickZoom={interactive}
        zoomControl={interactive}
        attributionControl
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
        {center ? <Recenter center={center} recenterKey={recenterKey} zoom={mapZoom} /> : null}

        {area?.enabled && area.center ? (
          <Circle
            center={[area.center.lat, area.center.lng]}
            radius={area.radiusMeters}
            pathOptions={{ color: '#b6f25a', weight: 2, dashArray: '6 8', fillOpacity: 0.05 }}
          >
            <Tooltip direction="top">Play area · {Math.round(area.radiusMeters)} m radius</Tooltip>
          </Circle>
        ) : null}

        {center && typeof accuracyMeters === 'number' && accuracyMeters > 0 ? (
          <Circle
            center={[center.lat, center.lng]}
            radius={Math.min(accuracyMeters, 500)}
            pathOptions={{ color: '#6fd3ff', weight: 1, fillOpacity: 0.12 }}
          />
        ) : null}

        {rings.map((ring) => (
          <Circle
            key={ring.id}
            center={[ring.lat, ring.lng]}
            radius={ring.radiusMeters}
            pathOptions={{
              color: ring.color,
              weight: 2,
              dashArray: ring.dashed ? '4 6' : undefined,
              fillOpacity: 0.08,
            }}
          >
            {ring.label ? <Tooltip direction="top">{ring.label}</Tooltip> : null}
          </Circle>
        ))}

        {pins.map((pin) => (
          <CircleMarker
            key={pin.id}
            center={[pin.lat, pin.lng]}
            radius={pin.radius ?? 9}
            pathOptions={{
              color: pin.color,
              weight: 2,
              fillColor: pin.fill === false ? '#0b1210' : pin.color,
              fillOpacity: pin.fill === false ? 0.55 : 0.9,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span className="map-tip">
                <strong>{pin.label}</strong>
                {pin.sublabel ? <em>{pin.sublabel}</em> : null}
              </span>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
