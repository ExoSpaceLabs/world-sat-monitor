"use client";

import {useEffect, useMemo, useState, type FormEvent} from "react";
import type {Basemap} from "../../domain/types";
import type {CatalogSearchResult, ManagedSatellite, Satellite} from "../../domain/satellite";
import type {SolarState} from "../../domain/solar";
import {solarElevation} from "../../domain/solar";
import {
  activateManagedSatellite,
  createManagedSatellite,
  deactivateManagedSatellite,
  deleteManagedSatellite,
  listManagedSatellites,
  searchSatelliteCatalog,
} from "../../services/worldsat-api";

type SatellitePanelProps = {
  basemap: Basemap;
  followSatellite: boolean;
  satellite: Satellite;
  managedSatellites: ManagedSatellite[];
  selectedNoradId: string;
  positionReady: boolean;
  solarState: SolarState;
  isMock: boolean;
  interpolated: boolean;
  onSelect: (noradId: string) => void;
  onToggleFollow: () => void;
};

type SatelliteManagerProps = {
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
};

function signedDegrees(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}°`;
}

export function SatelliteManager({onClose, onChanged}: SatelliteManagerProps) {
  const [satellites, setSatellites] = useState<ManagedSatellite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [norad, setNorad] = useState("");
  const [cospar, setCospar] = useState("");
  const [monitorNow, setMonitorNow] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const notifyChanged = () => {
    if (!onChanged) return;
    void Promise.resolve(onChanged()).catch(() => undefined);
  };

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

  const replaceOrAppend = (item: ManagedSatellite) => {
    setSatellites((current) => {
      const without = current.filter((satellite) => satellite.id !== item.id);
      return [...without, item].sort((left, right) => left.name.localeCompare(right.name));
    });
  };

  const refreshCatalogLocal = (satellite: ManagedSatellite) => {
    setCatalogResults((current) => current.map((result) => {
      const same = Object.entries(result.identifiers).some(
        ([namespace, value]) => satellite.identifiers[namespace] === value,
      );
      return same ? {
        ...result,
        local: {
          present: true,
          satellite_id: satellite.id,
          active: satellite.active,
          name: satellite.name,
        },
      } : result;
    }));
  };

  const toggleActive = async (item: ManagedSatellite) => {
    setBusyId(item.id);
    setError(null);
    try {
      const updated = item.active
        ? await deactivateManagedSatellite(item.id)
        : await activateManagedSatellite(item.id);
      replaceOrAppend(updated);
      refreshCatalogLocal(updated);
      notifyChanged();
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
      setCatalogResults((current) => current.map((result) => (
        result.local.satellite_id === item.id
          ? {...result, local: {present: false, satellite_id: null, active: false, name: null}}
          : result
      )));
      notifyChanged();
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
      replaceOrAppend(created);
      setName("");
      setNorad("");
      setCospar("");
      setMonitorNow(false);
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add satellite");
    } finally {
      setBusyId(null);
    }
  };

  const searchCatalog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = catalogQuery.trim();
    if (query.length < 2) return;
    setCatalogLoading(true);
    setError(null);
    try {
      setCatalogResults(await searchSatelliteCatalog(query));
    } catch (caught) {
      setCatalogResults([]);
      setError(caught instanceof Error ? caught.message : "Catalog search failed");
    } finally {
      setCatalogLoading(false);
    }
  };

  const addCatalogResult = async (result: CatalogSearchResult, active: boolean) => {
    if (result.local.present && result.local.satellite_id !== null) {
      const existing = satellites.find((satellite) => satellite.id === result.local.satellite_id);
      if (active && existing && !existing.active) await toggleActive(existing);
      return;
    }

    setBusyId(-2);
    setError(null);
    try {
      const created = await createManagedSatellite({
        name: result.name,
        active,
        object_type: result.object_type ?? "payload",
        provider_preference: result.provider,
        metadata: {
          catalog_source: result.provider,
          provider_object_id: result.provider_object_id,
          ...result.metadata,
        },
        identifiers: Object.entries(result.identifiers).map(([namespace, value]) => ({namespace, value})),
      });
      replaceOrAppend(created);
      refreshCatalogLocal(created);
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add catalog satellite");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className="sat-manager" aria-label="Satellite management">
      <div className="sat-manager-head">
        <div><small>LOCAL + PROVIDER CATALOG</small><strong>SATELLITES</strong></div>
        <button type="button" onClick={onClose} aria-label="Close satellite manager">×</button>
      </div>

      <form className="sat-catalog-search" onSubmit={searchCatalog}>
        <input
          value={catalogQuery}
          onChange={(event) => setCatalogQuery(event.target.value)}
          placeholder="Search name, NORAD or COSPAR"
          aria-label="Search satellite catalog"
          minLength={2}
        />
        <button type="submit" disabled={catalogLoading || busyId !== null}>
          {catalogLoading ? "SEARCHING…" : "SEARCH CELESTRAK"}
        </button>
      </form>

      {catalogResults.length > 0 && (
        <div className="sat-catalog-results">
          {catalogResults.map((result) => (
            <div className="sat-catalog-result" key={`${result.provider}:${result.provider_object_id}`}>
              <div>
                <strong>{result.name}</strong>
                <small>
                  NORAD {result.identifiers.NORAD_CAT_ID ?? "—"}
                  {result.identifiers.COSPAR ? ` · ${result.identifiers.COSPAR}` : ""}
                </small>
              </div>
              {result.local.present ? (
                result.local.active ? (
                  <span className="active">MONITORING</span>
                ) : (
                  <button type="button" disabled={busyId !== null} onClick={() => void addCatalogResult(result, true)}>
                    MONITOR
                  </button>
                )
              ) : (
                <div className="sat-catalog-actions">
                  <button type="button" disabled={busyId !== null} onClick={() => void addCatalogResult(result, false)}>
                    ADD
                  </button>
                  <button type="button" disabled={busyId !== null} onClick={() => void addCatalogResult(result, true)}>
                    ADD & MONITOR
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sat-manager-divider">MANUAL ENTRY</div>
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
  managedSatellites,
  selectedNoradId,
  positionReady,
  solarState,
  isMock,
  interpolated,
  onSelect,
  onToggleFollow,
}: SatellitePanelProps) {
  const activeSatellites = useMemo(
    () => managedSatellites.filter((item) => item.active && item.norad_id),
    [managedSatellites],
  );
  const selectedReady = positionReady && satellite.norad === selectedNoradId;
  const sunElevation = selectedReady ? solarElevation(satellite.lat, satellite.lon, solarState) : null;

  return (
    <aside className="sat-card" data-layer="satellite-controls" aria-label="Displayed objects">
      <div className="card-head">
        <span className="status-dot"/>
        <div><small>DISPLAYED OBJECTS</small><h1>{activeSatellites.length || 1} ACTIVE</h1></div>
        <b>SINGLE VIEW</b>
      </div>

      <div className="sat-object-list">
        {activeSatellites.length === 0 && (
          <div className="sat-object-row selected pending">
            <span className="sat-object-dot"/>
            <span><strong>{satellite.name}</strong><small>NORAD {satellite.norad || "—"}</small></span>
            <em>LOADING</em>
          </div>
        )}
        {activeSatellites.map((item) => {
          const noradId = item.norad_id as string;
          const selected = noradId === selectedNoradId;
          return (
            <div className={`sat-object-entry ${selected ? "selected" : ""}`} key={item.id}>
              <button className="sat-object-row" type="button" onClick={() => onSelect(noradId)} aria-expanded={selected}>
                <span className="sat-object-dot"/>
                <span><strong>{item.name}</strong><small>NORAD {noradId}</small></span>
                <em>{selected ? "DISPLAYED" : "SELECT"}</em>
              </button>
              {selected && (
                <div className="sat-object-details">
                  {!selectedReady ? (
                    <div className="sat-position-wait">WAITING FOR PROPAGATED POSITION…</div>
                  ) : (
                    <>
                      <dl>
                        <div><dt>ALTITUDE</dt><dd>{satellite.altitude.toFixed(1)} <small>km</small></dd></div>
                        <div><dt>HEADING</dt><dd>{satellite.heading.toFixed(1)}°</dd></div>
                        <div><dt>LATITUDE</dt><dd>{signedDegrees(satellite.lat)}</dd></div>
                        <div><dt>LONGITUDE</dt><dd>{signedDegrees(satellite.lon)}</dd></div>
                      </dl>
                      <div className="data-row"><span>BASEMAP</span><b>{basemap.toUpperCase()}</b></div>
                      <div className="data-row"><span>POSITION</span><b>{interpolated ? "INTERPOLATED" : "RAW SAMPLE"}</b></div>
                      <div className="data-row"><span>SOURCE</span><b>{isMock ? "MOCK OMM" : "PROPAGATED"}</b></div>
                      <div className="data-row"><span>ILLUMINATION</span><b className={(sunElevation ?? -1) >= 0 ? "daylight" : "nighttime"}>{(sunElevation ?? -1) >= 0 ? "DAYLIGHT" : "NIGHT"}</b></div>
                      <button className={`follow-button ${followSatellite ? "active" : ""}`} onClick={onToggleFollow} aria-pressed={followSatellite}>
                        {followSatellite ? "FOLLOWING SATELLITE" : "FOLLOW SATELLITE"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
