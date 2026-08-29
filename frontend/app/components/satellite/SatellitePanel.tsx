"use client";

import {useEffect, useMemo, useState, type FormEvent} from "react";
import type {CatalogGroupDefinition} from "../../domain/catalog-group";
import type {Basemap} from "../../domain/types";
import type {
  CatalogSearchResult,
  GroupPosition,
  ManagedSatellite,
  Satellite,
  SatelliteGroup,
  SatelliteGroupMember,
  SatelliteGroupType,
} from "../../domain/satellite";
import type {SolarState} from "../../domain/solar";
import {solarElevation} from "../../domain/solar";
import {
  importProviderCatalogGroup,
  listProviderCatalogGroups,
  searchProviderCatalogGroups,
} from "../../services/catalog-groups-api";
import {
  activateManagedSatellite,
  addSatelliteGroupMember,
  createManagedSatellite,
  createSatelliteGroup,
  deactivateManagedSatellite,
  deleteManagedSatellite,
  deleteSatelliteGroup,
  listManagedSatellites,
  listSatelliteGroupMembers,
  purgeSatelliteGroup,
  removeSatelliteGroupMember,
  searchSatelliteCatalog,
  updateSatelliteGroup,
} from "../../services/worldsat-api";

type SatellitePanelProps = {
  satellite: Satellite;
  managedSatellites: ManagedSatellite[];
  selectedNoradId: string;
  onSelect: (noradId: string) => void;
};

type DetailsPanelProps = {
  basemap: Basemap;
  followSatellite: boolean;
  satellite: Satellite;
  group: SatelliteGroup | null;
  groupPositions: GroupPosition[];
  displayMode: "satellite" | "group";
  positionReady: boolean;
  solarState: SolarState;
  isMock: boolean;
  interpolated: boolean;
  docked: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
};

type SatelliteManagerProps = {
  groups: SatelliteGroup[];
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
};

type ManagerTab = "single" | "grouped";

function signedDegrees(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}°`;
}

function formatTimestamp(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function SatelliteManager({groups, onClose, onChanged}: SatelliteManagerProps) {
  const [tab, setTab] = useState<ManagerTab>("single");
  const [satellites, setSatellites] = useState<ManagedSatellite[]>([]);
  const [groupedSatelliteIds, setGroupedSatelliteIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [members, setMembers] = useState<SatelliteGroupMember[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyGroupId, setBusyGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [norad, setNorad] = useState("");
  const [cospar, setCospar] = useState("");
  const [monitorNow, setMonitorNow] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [providerGroups, setProviderGroups] = useState<CatalogGroupDefinition[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [providerSearchResults, setProviderSearchResults] = useState<CatalogGroupDefinition[]>([]);
  const [providerSearchDone, setProviderSearchDone] = useState(false);
  const [searchingGroups, setSearchingGroups] = useState(false);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupType, setGroupType] = useState<SatelliteGroupType>("custom");

  const standaloneSatellites = useMemo(
    () => satellites.filter((item) => !groupedSatelliteIds.has(item.id)),
    [groupedSatelliteIds, satellites],
  );
  const expanded = groups.find((group) => group.id === expandedId) ?? null;
  const expandedMemberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const candidates = useMemo(
    () => satellites.filter((item) => !expandedMemberIds.has(item.id)),
    [expandedMemberIds, satellites],
  );

  const notifyChanged = () => {
    if (!onChanged) return;
    void Promise.resolve(onChanged()).catch(() => undefined);
  };

  const loadSatellites = async () => {
    const loaded = await listManagedSatellites();
    setSatellites(loaded);
    return loaded;
  };

  useEffect(() => {
    let cancelled = false;
    void listManagedSatellites()
      .then((loaded) => { if (!cancelled) { setSatellites(loaded); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load managed objects"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadMembershipIndex = async () => {
      try {
        const memberLists = await Promise.all(groups.map((group) => listSatelliteGroupMembers(group.id)));
        if (!cancelled) setGroupedSatelliteIds(new Set(memberLists.flat().map((member) => member.id)));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not index grouped satellites");
      }
    };
    void loadMembershipIndex();
    return () => { cancelled = true; };
  }, [groups]);

  useEffect(() => {
    let cancelled = false;
    void listProviderCatalogGroups()
      .then((loaded) => { if (!cancelled) setProviderGroups(loaded); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load provider constellations"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (expandedId === null || !groups.some((group) => group.id === expandedId)) return;
    let cancelled = false;
    void listSatelliteGroupMembers(expandedId)
      .then((loaded) => { if (!cancelled) setMembers(loaded); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load group members"); });
    return () => { cancelled = true; };
  }, [expandedId, groups]);

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
        local: {present: true, satellite_id: satellite.id, active: satellite.active, name: satellite.name},
      } : result;
    }));
  };

  const toggleActive = async (item: ManagedSatellite) => {
    setBusyId(item.id); setError(null);
    try {
      const updated = item.active
        ? await deactivateManagedSatellite(item.id)
        : await activateManagedSatellite(item.id);
      replaceOrAppend(updated);
      setMembers((current) => current.map((member) => member.id === updated.id ? {...member, active: updated.active} : member));
      refreshCatalogLocal(updated);
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change monitoring state");
    } finally { setBusyId(null); }
  };

  const removeSatellite = async (item: ManagedSatellite, fromGroup = false) => {
    if (item.active) return;
    if (!window.confirm(`Delete ${item.name} from the local catalog?${fromGroup ? " Its group memberships and propagated data will also be removed." : ""}`)) return;
    setBusyId(item.id); setError(null);
    try {
      await deleteManagedSatellite(item.id);
      setSatellites((current) => current.filter((satellite) => satellite.id !== item.id));
      setMembers((current) => current.filter((member) => member.id !== item.id));
      setGroupedSatelliteIds((current) => { const next = new Set(current); next.delete(item.id); return next; });
      setCatalogResults((current) => current.map((result) => result.local.satellite_id === item.id
        ? {...result, local: {present: false, satellite_id: null, active: false, name: null}}
        : result));
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete satellite");
    } finally { setBusyId(null); }
  };

  const addSatellite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const identifiers: Array<{namespace: string; value: string}> = [];
    if (norad.trim()) identifiers.push({namespace: "NORAD_CAT_ID", value: norad.trim()});
    if (cospar.trim()) identifiers.push({namespace: "COSPAR", value: cospar.trim()});
    setBusyId(-1); setError(null);
    try {
      const created = await createManagedSatellite({name: cleanName, active: monitorNow, identifiers});
      replaceOrAppend(created);
      setName(""); setNorad(""); setCospar(""); setMonitorNow(false);
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add satellite");
    } finally { setBusyId(null); }
  };

  const searchCatalog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = catalogQuery.trim();
    if (query.length < 2) return;
    setCatalogLoading(true); setError(null);
    try { setCatalogResults(await searchSatelliteCatalog(query)); }
    catch (caught) { setCatalogResults([]); setError(caught instanceof Error ? caught.message : "Catalog search failed"); }
    finally { setCatalogLoading(false); }
  };

  const addCatalogResult = async (result: CatalogSearchResult, active: boolean) => {
    if (result.local.present && result.local.satellite_id !== null) {
      const existing = satellites.find((satellite) => satellite.id === result.local.satellite_id);
      if (active && existing && !existing.active) await toggleActive(existing);
      return;
    }
    setBusyId(-2); setError(null);
    try {
      const created = await createManagedSatellite({
        name: result.name,
        active,
        object_type: result.object_type ?? "payload",
        provider_preference: result.provider,
        metadata: {catalog_source: result.provider, provider_object_id: result.provider_object_id, ...result.metadata},
        identifiers: Object.entries(result.identifiers).map(([namespace, value]) => ({namespace, value})),
      });
      replaceOrAppend(created);
      refreshCatalogLocal(created);
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add catalog satellite");
    } finally { setBusyId(null); }
  };

  const searchGroups = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = groupSearch.trim();
    if (query.length < 2) return;
    setSearchingGroups(true); setProviderSearchDone(false); setError(null);
    try { setProviderSearchResults(await searchProviderCatalogGroups(query)); setProviderSearchDone(true); }
    catch (caught) { setProviderSearchResults([]); setProviderSearchDone(true); setError(caught instanceof Error ? caught.message : "Constellation search failed"); }
    finally { setSearchingGroups(false); }
  };

  const syncProviderGroup = async (group: CatalogGroupDefinition) => {
    if (!group.available || busyGroupId !== null) return;
    setBusyGroupId(group.local.group_id ?? -1); setProviderNotice(null); setError(null);
    try {
      const result = await importProviderCatalogGroup(group.key);
      setProviderNotice(`${result.group.name}: ${result.group.member_count} members · ${result.created_satellites} new local objects`);
      setProviderGroups(await listProviderCatalogGroups());
      if (groupSearch.trim().length >= 2) setProviderSearchResults(await searchProviderCatalogGroups(groupSearch.trim()));
      await loadSatellites();
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import constellation");
    } finally { setBusyGroupId(null); }
  };

  const createGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = groupName.trim();
    if (!cleanName || busyGroupId !== null) return;
    setBusyGroupId(-2); setError(null);
    try {
      const created = await createSatelliteGroup({name: cleanName, group_type: groupType});
      setGroupName(""); setExpandedId(created.id); setMembers([]);
      notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create group");
    } finally { setBusyGroupId(null); }
  };

  const renameGroup = async (group: SatelliteGroup) => {
    if (group.source !== "user" || busyGroupId !== null) return;
    const nextName = window.prompt("Group name", group.name)?.trim();
    if (!nextName || nextName === group.name) return;
    setBusyGroupId(group.id); setError(null);
    try { await updateSatelliteGroup(group.id, {name: nextName}); notifyChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not rename group"); }
    finally { setBusyGroupId(null); }
  };

  const removeGroupOnly = async (group: SatelliteGroup) => {
    if (group.source !== "user" || busyGroupId !== null) return;
    if (!window.confirm(`Delete group ${group.name}? Satellites remain in the local catalog.`)) return;
    setBusyGroupId(group.id); setError(null);
    try {
      await deleteSatelliteGroup(group.id);
      if (expandedId === group.id) { setExpandedId(null); setMembers([]); }
      notifyChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete group"); }
    finally { setBusyGroupId(null); }
  };

  const purgeGroup = async (group: SatelliteGroup) => {
    if (busyGroupId !== null) return;
    if (group.active_member_count > 0) {
      setError(`${group.name} has ${group.active_member_count} active member(s). Stop monitoring them before deleting the collection.`);
      return;
    }
    const warning = `Delete all ${group.member_count} local satellites in ${group.name} and remove the collection?\n\nThis is destructive. Satellites shared with other groups are deleted there too.`;
    if (!window.confirm(warning)) return;
    setBusyGroupId(group.id); setError(null);
    try {
      const result = await purgeSatelliteGroup(group.id);
      setProviderNotice(`${group.name}: deleted ${result.deleted_satellites} local satellites`);
      if (expandedId === group.id) { setExpandedId(null); setMembers([]); }
      await loadSatellites();
      setProviderGroups(await listProviderCatalogGroups());
      notifyChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete collection satellites"); }
    finally { setBusyGroupId(null); }
  };

  const toggleExpanded = async (group: SatelliteGroup) => {
    if (expandedId === group.id) {
      setExpandedId(null); setMembers([]); setCandidateId(""); return;
    }
    setExpandedId(group.id); setMembers([]); setCandidateId(""); setError(null);
    try { setMembers(await listSatelliteGroupMembers(group.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load group members"); }
  };

  const addMember = async () => {
    if (!expanded || expanded.source !== "user" || !candidateId || busyGroupId !== null) return;
    setBusyGroupId(expanded.id); setError(null);
    try {
      const added = await addSatelliteGroupMember(expanded.id, Number(candidateId));
      setCandidateId("");
      setMembers((current) => [...current.filter((member) => member.id !== added.id), added].sort((left, right) => left.name.localeCompare(right.name)));
      setGroupedSatelliteIds((current) => new Set(current).add(added.id));
      notifyChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add group member"); }
    finally { setBusyGroupId(null); }
  };

  const removeMember = async (member: SatelliteGroupMember) => {
    if (!expanded || expanded.source !== "user" || busyGroupId !== null) return;
    setBusyGroupId(expanded.id); setError(null);
    try {
      await removeSatelliteGroupMember(expanded.id, member.id);
      setMembers((current) => current.filter((item) => item.id !== member.id));
      notifyChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove group member"); }
    finally { setBusyGroupId(null); }
  };

  const providerRow = (group: CatalogGroupDefinition) => (
    <div className="provider-group-row" key={`${group.provider}:${group.key}`}>
      <span><strong>{group.name}</strong><small>{group.key} · {group.local.present ? `${group.local.member_count} MEMBERS · IMPORTED` : "NOT IMPORTED"}</small></span>
      <button type="button" disabled={busyGroupId !== null || !group.available} onClick={() => void syncProviderGroup(group)}>{group.local.present ? "SYNC" : "IMPORT"}</button>
    </div>
  );

  return (
    <aside className="sat-manager" aria-label="Object management">
      <div className="sat-manager-head"><div><small>LOCAL + PROVIDER CATALOG</small><strong>MANAGER</strong></div><button type="button" onClick={onClose} aria-label="Close manager">×</button></div>
      <div className="sat-manager-tabs" role="tablist" aria-label="Manager mode">
        <button className={tab === "single" ? "active" : ""} type="button" role="tab" aria-selected={tab === "single"} onClick={() => setTab("single")}>SINGLE</button>
        <button className={tab === "grouped" ? "active" : ""} type="button" role="tab" aria-selected={tab === "grouped"} onClick={() => setTab("grouped")}>GROUPED</button>
      </div>
      {error && <div className="sat-manager-error" role="alert">{error}</div>}

      {tab === "single" ? <>
        <form className="sat-catalog-search" onSubmit={searchCatalog}>
          <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search name, NORAD or COSPAR" aria-label="Search satellite catalog" minLength={2}/>
          <button type="submit" disabled={catalogLoading || busyId !== null}>{catalogLoading ? "SEARCHING…" : "SEARCH CELESTRAK"}</button>
        </form>
        {catalogResults.length > 0 && <div className="sat-catalog-results">{catalogResults.map((result) => <div className="sat-catalog-result" key={`${result.provider}:${result.provider_object_id}`}>
          <div><strong>{result.name}</strong><small>NORAD {result.identifiers.NORAD_CAT_ID ?? "—"}{result.identifiers.COSPAR ? ` · ${result.identifiers.COSPAR}` : ""}</small></div>
          {result.local.present ? (result.local.active ? <span className="active">MONITORING</span> : <button type="button" disabled={busyId !== null} onClick={() => void addCatalogResult(result, true)}>MONITOR</button>) : <div className="sat-catalog-actions"><button type="button" disabled={busyId !== null} onClick={() => void addCatalogResult(result, false)}>ADD</button><button type="button" disabled={busyId !== null} onClick={() => void addCatalogResult(result, true)}>ADD & MONITOR</button></div>}
        </div>)}</div>}
        <div className="sat-manager-divider">MANUAL ENTRY</div>
        <form className="sat-add-form" onSubmit={addSatellite}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Satellite name" aria-label="Satellite name" required/>
          <div className="sat-add-identifiers"><input value={norad} onChange={(event) => setNorad(event.target.value)} placeholder="NORAD ID" aria-label="NORAD ID"/><input value={cospar} onChange={(event) => setCospar(event.target.value)} placeholder="COSPAR" aria-label="COSPAR ID"/></div>
          <label className="sat-monitor-now"><input type="checkbox" checked={monitorNow} onChange={(event) => setMonitorNow(event.target.checked)}/>MONITOR NOW</label>
          <button className="sat-add-button" type="submit" disabled={busyId !== null}>ADD SATELLITE</button>
        </form>
        <div className="sat-manager-divider">STANDALONE OBJECTS · {standaloneSatellites.length}{satellites.length > standaloneSatellites.length ? ` · ${satellites.length - standaloneSatellites.length} GROUPED HIDDEN` : ""}</div>
        <div className="sat-manager-list">
          {loading && <div className="sat-manager-empty">LOADING CATALOG…</div>}
          {!loading && standaloneSatellites.length === 0 && <div className="sat-manager-empty">NO STANDALONE SATELLITES</div>}
          {standaloneSatellites.map((item) => <div className="sat-manager-row" key={item.id}>
            <div className="sat-manager-object"><strong>{item.name}</strong><small>{item.norad_id ? `NORAD ${item.norad_id}` : `LOCAL #${item.id}`}</small></div>
            <span className={item.active ? "active" : "inactive"}>{item.active ? "ACTIVE" : "INACTIVE"}</span>
            <button type="button" onClick={() => void toggleActive(item)} disabled={busyId !== null}>{item.active ? "STOP" : "MONITOR"}</button>
            <button className="sat-delete" type="button" onClick={() => void removeSatellite(item)} disabled={item.active || busyId !== null} title={item.active ? "Deactivate before deleting" : "Delete satellite"}>DEL</button>
          </div>)}
        </div>
        <div className="sat-manager-note">Members of managed collections are intentionally collapsed into the GROUPED tab.</div>
      </> : <>
        <section className="manager-group-catalog" aria-label="Constellation catalog">
          <div className="provider-group-title"><span><small>CONSTELLATIONS</small><strong>CELESTRAK CATALOG</strong></span><small>IMPORTS STAY COLLAPSED BELOW</small></div>
          {providerGroups.map(providerRow)}
          <form className="provider-group-search" onSubmit={searchGroups}><input value={groupSearch} onChange={(event) => { setGroupSearch(event.target.value); setProviderSearchDone(false); }} placeholder="Starlink, Galileo, Planet, Spire…" aria-label="Search provider constellations"/><button type="submit" disabled={searchingGroups || groupSearch.trim().length < 2}>{searchingGroups ? "SEARCH…" : "SEARCH"}</button></form>
          {providerSearchResults.map(providerRow)}
          {providerSearchDone && providerSearchResults.length === 0 && <div className="provider-group-search-empty">NO MATCHING CELESTRAK GROUPS</div>}
          {providerNotice && <div className="provider-group-notice">{providerNotice}</div>}
        </section>
        <div className="sat-manager-divider">CREATE GROUP</div>
        <form className="group-create manager-group-create" onSubmit={createGroup}><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="New group name" aria-label="New group name"/><select value={groupType} onChange={(event) => setGroupType(event.target.value as SatelliteGroupType)} aria-label="Group type"><option value="custom">CUSTOM</option><option value="mission">MISSION</option><option value="constellation">CONSTELLATION</option></select><button type="submit" disabled={busyGroupId !== null || !groupName.trim()}>CREATE</button></form>
        <div className="sat-manager-divider">MANAGED COLLECTIONS · {groups.length}</div>
        <div className="manager-group-list">
          {groups.length === 0 && <div className="sat-manager-empty">NO COLLECTIONS DEFINED</div>}
          {groups.map((group) => {
            const isExpanded = expandedId === group.id;
            return <div className={`manager-group-entry ${isExpanded ? "expanded" : ""}`} key={group.id}>
              <div className="manager-group-row">
                <button className="manager-group-expand" type="button" onClick={() => void toggleExpanded(group)} aria-expanded={isExpanded}><span className="manager-chevron">{isExpanded ? "▾" : "▸"}</span><span><strong>{group.name}</strong><small>{group.group_type.toUpperCase()} · {group.member_count} MEMBERS · {group.source.toUpperCase()}</small></span></button>
                {group.source === "user" && <button type="button" disabled={busyGroupId !== null} onClick={() => void renameGroup(group)}>RENAME</button>}
                {group.source === "user" && <button type="button" disabled={busyGroupId !== null} onClick={() => void removeGroupOnly(group)}>DEL GROUP</button>}
                <button className="manager-purge" type="button" disabled={busyGroupId !== null || group.active_member_count > 0} onClick={() => void purgeGroup(group)} title={group.active_member_count > 0 ? "Stop active members before deleting all satellites" : "Delete all member satellites and the collection"}>DELETE SATS</button>
              </div>
              {isExpanded && <div className="manager-group-members">
                {group.source === "user" && <div className="group-add-member"><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} aria-label="Satellite to add to group"><option value="">ADD SATELLITE…</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · NORAD {candidate.norad_id ?? "—"}</option>)}</select><button type="button" onClick={() => void addMember()} disabled={busyGroupId !== null || !candidateId}>ADD</button></div>}
                {members.length === 0 && <div className="sat-manager-empty">NO MEMBERS</div>}
                {members.map((member) => <div className="manager-group-member" key={member.id}><span className={member.active ? "active" : "inactive"}/><div><strong>{member.name}</strong><small>NORAD {member.norad_id ?? "—"}</small></div><button type="button" onClick={() => void toggleActive(member)} disabled={busyId !== null}>{member.active ? "STOP" : "MONITOR"}</button>{group.source === "user" ? <button type="button" disabled={busyGroupId !== null} onClick={() => void removeMember(member)}>REMOVE</button> : <button className="sat-delete" type="button" disabled={member.active || busyId !== null} onClick={() => void removeSatellite(member, true)}>DELETE</button>}</div>)}
              </div>}
            </div>;
          })}
        </div>
        <div className="sat-manager-note">Collections stay collapsed by default. Deleting all satellites is intentionally blocked while any member is active.</div>
      </>}
    </aside>
  );
}

export function SatellitePanel({satellite, managedSatellites, selectedNoradId, onSelect}: SatellitePanelProps) {
  const activeSatellites = useMemo(() => managedSatellites.filter((item) => item.active && item.norad_id), [managedSatellites]);
  return <aside className="sat-card" data-layer="satellite-controls" aria-label="Single satellite list">
    <div className="card-head"><span className="status-dot"/><div><small>ACTIVE OBJECTS</small><h1>SINGLE</h1></div><b>{activeSatellites.length || 1} ACTIVE</b></div>
    <div className="sat-object-list">
      {activeSatellites.length === 0 && <div className="sat-object-row pending"><span className="sat-object-dot"/><span><strong>{satellite.name}</strong><small>NORAD {satellite.norad || "—"}</small></span><em>LOADING</em></div>}
      {activeSatellites.map((item) => {
        const noradId = item.norad_id as string;
        const selected = noradId === selectedNoradId;
        return <button className={`sat-object-row ${selected ? "selected" : ""}`} type="button" key={item.id} onClick={() => onSelect(noradId)} aria-pressed={selected}><span className="sat-object-dot"/><span><strong>{item.name}</strong><small>NORAD {noradId}</small></span><em>{selected ? "DISPLAYED" : "SELECT"}</em></button>;
      })}
    </div>
  </aside>;
}

export function DetailsPanel({basemap, followSatellite, satellite, group, groupPositions, displayMode, positionReady, solarState, isMock, interpolated, docked, onToggleFollow, onClose}: DetailsPanelProps) {
  const selectedReady = displayMode === "satellite" && positionReady;
  const sunElevation = selectedReady ? solarElevation(satellite.lat, satellite.lon, solarState) : null;
  const positioned = useMemo(() => groupPositions.filter((entry) => entry.position !== null), [groupPositions]);
  const altitudes = useMemo(() => positioned.map((entry) => entry.position?.altitude_km ?? 0), [positioned]);
  const avgAltitude = altitudes.length ? altitudes.reduce((sum, value) => sum + value, 0) / altitudes.length : null;
  const minAltitude = altitudes.length ? Math.min(...altitudes) : null;
  const maxAltitude = altitudes.length ? Math.max(...altitudes) : null;
  const coverage = group && group.member_count > 0 ? positioned.length / group.member_count * 100 : 0;

  return <aside className={`details-card ${docked ? "docked" : ""}`} aria-label="Display details">
    <div className="card-head details-head"><span className="status-dot"/><div><small>DISPLAY DETAILS</small><h1>{displayMode === "group" ? group?.name ?? "GROUP" : satellite.name}</h1></div><b>{displayMode === "group" ? "GROUP" : "SINGLE"}</b><button className="details-close" type="button" onClick={onClose} aria-label="Close details">×</button></div>
    {displayMode === "satellite" ? (!selectedReady ? <div className="sat-position-wait">WAITING FOR PROPAGATED POSITION…</div> : <>
      <dl className="details-grid"><div><dt>ALTITUDE</dt><dd>{satellite.altitude.toFixed(1)} <small>km</small></dd></div><div><dt>HEADING</dt><dd>{satellite.heading.toFixed(1)}°</dd></div><div><dt>LATITUDE</dt><dd>{signedDegrees(satellite.lat)}</dd></div><div><dt>LONGITUDE</dt><dd>{signedDegrees(satellite.lon)}</dd></div></dl>
      <div className="data-row"><span>BASEMAP</span><b>{basemap.toUpperCase()}</b></div><div className="data-row"><span>POSITION</span><b>{interpolated ? "INTERPOLATED" : "RAW SAMPLE"}</b></div><div className="data-row"><span>SOURCE</span><b>{isMock ? "MOCK OMM" : "PROPAGATED"}</b></div><div className="data-row"><span>ILLUMINATION</span><b className={(sunElevation ?? -1) >= 0 ? "daylight" : "nighttime"}>{(sunElevation ?? -1) >= 0 ? "DAYLIGHT" : "NIGHT"}</b></div>
      <button className={`follow-button ${followSatellite ? "active" : ""}`} onClick={onToggleFollow} aria-pressed={followSatellite}>{followSatellite ? "FOLLOWING SATELLITE" : "FOLLOW SATELLITE"}</button>
    </>) : group ? <>
      <dl className="details-grid"><div><dt>MEMBERS</dt><dd>{group.member_count}</dd></div><div><dt>ACTIVE</dt><dd>{group.active_member_count}</dd></div><div><dt>POSITIONS READY</dt><dd>{positioned.length}</dd></div><div><dt>COVERAGE</dt><dd>{coverage.toFixed(1)}%</dd></div></dl>
      <div className="data-row"><span>TYPE</span><b>{group.group_type.toUpperCase()}</b></div><div className="data-row"><span>SOURCE</span><b>{group.source.toUpperCase()}</b></div><div className="data-row"><span>SOURCE KEY</span><b>{group.source_key ?? "—"}</b></div><div className="data-row"><span>AVG ALTITUDE</span><b>{avgAltitude === null ? "—" : `${avgAltitude.toFixed(1)} km`}</b></div><div className="data-row"><span>ALTITUDE RANGE</span><b>{minAltitude === null || maxAltitude === null ? "—" : `${minAltitude.toFixed(0)}–${maxAltitude.toFixed(0)} km`}</b></div><div className="data-row"><span>LAST SYNC</span><b>{formatTimestamp(group.metadata.last_synced_at)}</b></div>
    </> : <div className="sat-position-wait">SELECT A GROUP TO DISPLAY ITS DETAILS.</div>}
  </aside>;
}
