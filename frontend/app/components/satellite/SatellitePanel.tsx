"use client";

import {useEffect, useState, type FormEvent} from "react";
import type {Basemap} from "../../domain/types";
import type {ManagedSatellite, Satellite} from "../../domain/satellite";
import type {SolarState} from "../../domain/solar";
import {solarElevation} from "../../domain/solar";
import {
  activateManagedSatellite,
  createManagedSatellite,
  deactivateManagedSatellite,
  deleteManagedSatellite,
  listManagedSatellites,
} from "../../services/worldsat-api";

type SatellitePanelProps = {
  basemap: Basemap;
  followSatellite: boolean;
  satellite: Satellite;
  solarState: SolarState;
  isMock: boolean;
  interpolated: boolean;
  onToggleFollow: () => void;
};

function signedDegrees(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}°`;
}

function SatelliteManager({onClose}: {onClose: () => void}) {
  const [satellites, setSatellites] = useState<ManagedSatellite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [norad, setNorad] = useState("");
  const [cospar, setCospar] = useState("");
  const [monitorNow, setMonitorNow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await listManagedSatellites();
        if (cancelled) return;
        setSatellites(loaded);
        setError(null);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load satellites");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const toggleActive = async (item: ManagedSatellite) => {
    setBusyId(item.id);
    setError(null);
    try {
      const updated = item.active
        ? await deactivateManagedSatellite(item.id)
        : await activateManagedSatellite(item.id);
      setSatellites((current) => current.map((satellite) => satellite.id === updated.id ? updated : satellite));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change monitoring state");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: ManagedSatellite) => {
    if (item.active) return;
    if (!window.confirm(`Delete ${item.name} from the local catalog?`)) return;
    setBusyId(item.id);
    setError(null);
    try {
      await deleteManagedSatellite(item.id);
      setSatellites((current) => current.filter((satellite) => satellite.id !== item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete satellite");
    } finally {
      setBusyId(null);
    }
  };

  const addSatellite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const identifiers: Array<{namespace: string; value: string}> = [];
    if (norad.trim()) identifiers.push({namespace: "NORAD_CAT_ID", value: norad.trim()});
    if (cospar.trim()) identifiers.push({namespace: "COSPAR", value: cospar.trim()});

    setBusyId(-1);
    setError(null);
    try {
      const created = await createManagedSatellite({
        name: cleanName,
        active: monitorNow,
        identifiers,
      });
      setSatellites((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
      setName("");
      setNorad("");
      setCospar("");
      setMonitorNow(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add satellite");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className="sat-manager" aria-label="Satellite management">
      <div className="sat-manager-head">
        <div><small>LOCAL CATALOG</small><strong>SATELLITES</strong></div>
        <button type="button" onClick={onClose} aria-label="Close satellite manager">×</button>
      </div>

      <form className="sat-add-form" onSubmit={addSatellite}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Satellite name" aria-label="Satellite name" required/>
        <div className="sat-add-identifiers">
          <input value={norad} onChange={(event) => setNorad(event.target.value)} placeholder="NORAD ID" aria-label="NORAD ID"/>
          <input value={cospar} onChange={(event) => setCospar(event.target.value)} placeholder="COSPAR" aria-label="COSPAR ID"/>
        </div>
        <label className="sat-monitor-now">
          <input type="checkbox" checked={monitorNow} onChange={(event) => setMonitorNow(event.target.checked)}/>
          MONITOR NOW
        </label>
        <button className="sat-add-button" type="submit" disabled={busyId !== null}>ADD SATELLITE</button>
      </form>

      {error && <div className="sat-manager-error" role="alert">{error}</div>}
      <div className="sat-manager-list">
        {loading && <div className="sat-manager-empty">LOADING CATALOG…</div>}
        {!loading && satellites.length === 0 && <div className="sat-manager-empty">NO SATELLITES SAVED</div>}
        {satellites.map((item) => (
          <div className="sat-manager-row" key={item.id}>
            <div className="sat-manager-object">
              <strong>{item.name}</strong>
              <small>{item.norad_id ? `NORAD ${item.norad_id}` : `LOCAL #${item.id}`}</small>
            </div>
            <span className={item.active ? "active" : "inactive"}>{item.active ? "ACTIVE" : "INACTIVE"}</span>
            <button type="button" onClick={() => void toggleActive(item)} disabled={busyId !== null}>
              {item.active ? "STOP" : "MONITOR"}
            </button>
            <button className="sat-delete" type="button" onClick={() => void remove(item)} disabled={item.active || busyId !== null} title={item.active ? "Deactivate before deleting" : "Delete satellite"}>
              DEL
            </button>
          </div>
        ))}
      </div>
      <div className="sat-manager-note">Inactive objects remain saved locally but are excluded from scheduled provider/propagation work.</div>
    </aside>
  );
}

export function SatellitePanel({
  basemap,
  followSatellite,
  satellite,
  solarState,
  isMock,
  interpolated,
  onToggleFollow,
}: SatellitePanelProps) {
  const [managerOpen, setManagerOpen] = useState(false);
  const sunElevation = solarElevation(satellite.lat, satellite.lon, solarState);
  return (
    <>
      <aside className="sat-card" data-layer="satellite-controls">
        <div className="card-head">
          <span className="status-dot"/>
          <div><small>DISPLAYED OBJECT</small><h1>{satellite.name}</h1></div>
          <b>{isMock ? "MOCK" : "LIVE"}</b>
        </div>
        <dl>
          <div><dt>ALTITUDE</dt><dd>{satellite.altitude.toFixed(1)} <small>km</small></dd></div>
          <div><dt>HEADING</dt><dd>{satellite.heading.toFixed(1)}°</dd></div>
          <div><dt>LATITUDE</dt><dd>{signedDegrees(satellite.lat)}</dd></div>
          <div><dt>LONGITUDE</dt><dd>{signedDegrees(satellite.lon)}</dd></div>
        </dl>
        <div className="data-row"><span>NORAD ID</span><b>{satellite.norad || "--"}</b></div>
        <div className="data-row"><span>BASEMAP</span><b>{basemap.toUpperCase()}</b></div>
        <div className="data-row"><span>POSITION</span><b>{interpolated ? "INTERPOLATED" : "RAW SAMPLE"}</b></div>
        <div className="data-row"><span>ILLUMINATION</span><b className={sunElevation >= 0 ? "daylight" : "nighttime"}>{sunElevation >= 0 ? "DAYLIGHT" : "NIGHT"}</b></div>
        <button className={`follow-button ${followSatellite ? "active" : ""}`} onClick={onToggleFollow} aria-pressed={followSatellite}>
          {followSatellite ? "FOLLOWING SATELLITE" : "FOLLOW SATELLITE"}
        </button>
        <button className={`manage-button ${managerOpen ? "active" : ""}`} onClick={() => setManagerOpen((open) => !open)} aria-expanded={managerOpen}>
          {managerOpen ? "CLOSE SATELLITE MANAGER" : "MANAGE SATELLITES"}
        </button>
      </aside>
      {managerOpen && <SatelliteManager onClose={() => setManagerOpen(false)}/>} 
    </>
  );
}
