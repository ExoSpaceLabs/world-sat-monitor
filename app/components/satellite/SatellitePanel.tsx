import type {Basemap} from "../../domain/types";
import type {Satellite} from "../../domain/satellite";
import type {SolarState} from "../../domain/solar";
import {solarElevation} from "../../domain/solar";

type SatellitePanelProps = {
  basemap: Basemap;
  followSatellite: boolean;
  satellite: Satellite;
  solarState: SolarState;
  onToggleFollow: () => void;
};

export function SatellitePanel({
  basemap,
  followSatellite,
  satellite,
  solarState,
  onToggleFollow,
}: SatellitePanelProps) {
  const sunElevation = solarElevation(satellite.lat, satellite.lon, solarState);
  return (
    <aside className="sat-card" data-layer="satellite-controls">
      <div className="card-head">
        <span className="status-dot"/>
        <div><small>ACTIVE OBJECT</small><h1>{satellite.name}</h1></div>
        <b>MOCK</b>
      </div>
      <dl>
        <div><dt>ALTITUDE</dt><dd>{satellite.altitude} <small>km</small></dd></div>
        <div><dt>HEADING</dt><dd>{satellite.heading}.0°</dd></div>
        <div><dt>LATITUDE</dt><dd>+{satellite.lat.toFixed(3)}°</dd></div>
        <div><dt>LONGITUDE</dt><dd>+{satellite.lon.toFixed(3)}°</dd></div>
      </dl>
      <div className="data-row"><span>NORAD ID</span><b>{satellite.norad}</b></div>
      <div className="data-row"><span>BASEMAP</span><b>{basemap.toUpperCase()}</b></div>
      <div className="data-row"><span>ILLUMINATION</span><b className={sunElevation >= 0 ? "daylight" : "nighttime"}>{sunElevation >= 0 ? "DAYLIGHT" : "NIGHT"}</b></div>
      <button
        className={`follow-button ${followSatellite ? "active" : ""}`}
        onClick={onToggleFollow}
        aria-pressed={followSatellite}
      >
        {followSatellite ? "FOLLOWING SATELLITE" : "FOLLOW SATELLITE"}
      </button>
    </aside>
  );
}
