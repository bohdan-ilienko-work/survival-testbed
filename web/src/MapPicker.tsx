import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Answer marker of one player, drawn on the results map. */
export interface GuessPin extends LatLng {
  label: string;
  mine?: boolean;
}

function ClickCatcher({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: +e.latlng.lat.toFixed(4), lng: +e.latlng.lng.toFixed(4) });
    },
  });
  return null;
}

/**
 * Real OSM map. CircleMarker is used instead of the default Leaflet marker on
 * purpose: the default icon loads its PNGs by relative path and silently breaks
 * under a bundler, while a vector marker has no assets at all.
 */
export function MapPicker({
  pick,
  guesses = [],
  correct,
  disabled,
  onPick,
  height = 320,
}: {
  pick?: LatLng | null;
  guesses?: GuessPin[];
  correct?: LatLng | null;
  disabled?: boolean;
  onPick?: (p: LatLng) => void;
  height?: number;
}) {
  return (
    <div className="leaflet-wrap" style={{ height }}>
      <MapContainer
        center={[20, 10]}
        zoom={2}
        minZoom={1}
        worldCopyJump
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {!disabled && onPick && <ClickCatcher onPick={onPick} />}

        {pick && (
          <CircleMarker center={[pick.lat, pick.lng]} radius={8} pathOptions={{ color: '#5b8cff', fillColor: '#5b8cff', fillOpacity: 0.9 }}>
            <Popup>твоя мітка</Popup>
          </CircleMarker>
        )}

        {correct && (
          <CircleMarker center={[correct.lat, correct.lng]} radius={9} pathOptions={{ color: '#3ecf8e', fillColor: '#3ecf8e', fillOpacity: 0.9 }}>
            <Popup>правильна відповідь</Popup>
          </CircleMarker>
        )}

        {guesses.map((g, i) => (
          <CircleMarker
            key={i}
            center={[g.lat, g.lng]}
            radius={6}
            pathOptions={{
              color: g.mine ? '#5b8cff' : '#ff6b6b',
              fillColor: g.mine ? '#5b8cff' : '#ff6b6b',
              fillOpacity: 0.75,
            }}
          >
            <Popup>{g.label}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
