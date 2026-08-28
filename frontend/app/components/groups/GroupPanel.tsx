"use client";

import {useEffect, useMemo, useState, type FormEvent} from "react";
import type {CatalogGroupDefinition} from "../../domain/catalog-group";
import type {ManagedSatellite, SatelliteGroup, SatelliteGroupMember, SatelliteGroupType} from "../../domain/satellite";
import {
  importProviderCatalogGroup,
  listProviderCatalogGroups,
  searchProviderCatalogGroups,
} from "../../services/catalog-groups-api";
import {
  addSatelliteGroupMember,
  createSatelliteGroup,
  deleteSatelliteGroup,
  listSatelliteGroupMembers,
  removeSatelliteGroupMember,
  updateSatelliteGroup,
} from "../../services/worldsat-api";

type GroupPanelProps = {
  groups: SatelliteGroup[];
  managedSatellites: ManagedSatellite[];
  displayedGroupId: number | null;
  onDisplayGroup: (groupId: number) => void;
  onChanged: () => void | Promise<void>;
  onSelectSatellite: (noradId: string) => void;
  onClose: () => void;
};

export function GroupPanel({
  groups,
  managedSatellites,
  displayedGroupId,
  onDisplayGroup,
  onChanged,
  onSelectSatellite,
  onClose,
}: GroupPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [members, setMembers] = useState<SatelliteGroupMember[]>([]);
  const [providerGroups, setProviderGroups] = useState<CatalogGroupDefinition[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [providerSearchResults, setProviderSearchResults] = useState<CatalogGroupDefinition[]>([]);
  const [providerSearchDone, setProviderSearchDone] = useState(false);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [groupType, setGroupType] = useState<SatelliteGroupType>("custom");
  const [candidateId, setCandidateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busyProviderKey, setBusyProviderKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expanded = groups.find((group) => group.id === expandedId) ?? null;
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const candidates = useMemo(() => managedSatellites.filter((satellite) => !memberIds.has(satellite.id)), [managedSatellites, memberIds]);

  const notifyChanged = async () => { await Promise.resolve(onChanged()); };
  const loadMembers = async (groupId: number) => { setMembers(await listSatelliteGroupMembers(groupId)); };

  useEffect(() => {
    let cancelled = false;
    void listProviderCatalogGroups()
      .then((loaded) => { if (!cancelled) { setProviderGroups(loaded); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load provider constellations"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (expandedId === null) return;
    let cancelled = false;
    void listSatelliteGroupMembers(expandedId)
      .then((loaded) => { if (!cancelled) { setMembers(loaded); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load group members"); });
    return () => { cancelled = true; };
  }, [expandedId]);

  const searchProviderGroups = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const clean = groupSearch.trim();
    if (clean.length < 2 || searching || busy) return;
    setSearching(true); setError(null); setProviderSearchDone(false);
    try {
      setProviderSearchResults(await searchProviderCatalogGroups(clean));
      setProviderSearchDone(true);
    } catch (caught) {
      setProviderSearchResults([]); setProviderSearchDone(true);
      setError(caught instanceof Error ? caught.message : "Could not search provider groups");
    } finally { setSearching(false); }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await createSatelliteGroup({name: cleanName, group_type: groupType});
      setName(""); setMembers([]); setExpandedId(created.id);
      await notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create group");
    } finally { setBusy(false); }
  };

  const syncProviderGroup = async (group: CatalogGroupDefinition) => {
    if (busy || busyProviderKey !== null || !group.available) return;
    setBusy(true); setBusyProviderKey(group.key); setError(null); setProviderNotice(null);
    try {
      const result = await importProviderCatalogGroup(group.key);
      setProviderGroups(await listProviderCatalogGroups());
      if (groupSearch.trim().length >= 2) setProviderSearchResults(await searchProviderCatalogGroups(groupSearch.trim()));
      setProviderNotice(`${result.group.name}: ${result.group.member_count} members · ${result.created_satellites} new inactive objects`);
      await notifyChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import provider group");
    } finally { setBusyProviderKey(null); setBusy(false); }
  };

  const rename = async (group: SatelliteGroup) => {
    if (group.source !== "user" || busy) return;
    const nextName = window.prompt("Group name", group.name)?.trim();
    if (!nextName || nextName === group.name) return;
    setBusy(true); setError(null);
    try { await updateSatelliteGroup(group.id, {name: nextName}); await notifyChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not rename group"); }
    finally { setBusy(false); }
  };

  const removeGroup = async (group: SatelliteGroup) => {
    if (group.source !== "user" || busy) return;
    if (!window.confirm(`Delete group ${group.name}? Satellites will not be deleted.`)) return;
    setBusy(true); setError(null);
    try {
      await deleteSatelliteGroup(group.id);
      if (expandedId === group.id) { setExpandedId(null); setMembers([]); }
      await notifyChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete group"); }
    finally { setBusy(false); }
  };

  const addMember = async () => {
    if (!expanded || expanded.source !== "user" || !candidateId || busy) return;
    setBusy(true); setError(null);
    try { await addSatelliteGroupMember(expanded.id, Number(candidateId)); setCandidateId(""); await loadMembers(expanded.id); await notifyChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add group member"); }
    finally { setBusy(false); }
  };

  const removeMember = async (member: SatelliteGroupMember) => {
    if (!expanded || expanded.source !== "user" || busy) return;
    setBusy(true); setError(null);
    try { await removeSatelliteGroupMember(expanded.id, member.id); await loadMembers(expanded.id); await notifyChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove group member"); }
    finally { setBusy(false); }
  };

  const toggleExpanded = (groupId: number, isExpanded: boolean) => {
    setMembers([]); setCandidateId(""); setExpandedId(isExpanded ? null : groupId);
  };

  const providerRow = (group: CatalogGroupDefinition) => (
    <div className="provider-group-row" key={`${group.provider}:${group.key}`}>
      <span><strong>{group.name}</strong><small>{group.key} · {group.local.present ? `${group.local.active_member_count}/${group.local.member_count} ACTIVE · IMPORTED` : "NOT IMPORTED"}</small></span>
      <button type="button" disabled={busy || !group.available} onClick={() => void syncProviderGroup(group)}>{busyProviderKey === group.key ? "SYNCING…" : group.local.present ? "SYNC" : "IMPORT"}</button>
    </div>
  );

  return (
    <aside className="group-panel" aria-label="Satellite groups">
      <div className="group-panel-head">
        <div><small>SETS + CONSTELLATIONS</small><strong>GROUPS</strong></div>
        <button type="button" onClick={onClose} aria-label="Close group panel">×</button>
      </div>

      <section className="provider-group-catalog" aria-label="Provider constellations">
        <div className="provider-group-title">
          <span><small>QUICK IMPORT</small><strong>CELESTRAK GROUPS</strong></span>
          <small>IMPORTS CREATE MISSING MEMBERS INACTIVE</small>
        </div>
        {providerGroups.length === 0 && <div className="group-empty">NO QUICK GROUPS AVAILABLE</div>}
        {providerGroups.map(providerRow)}
        <div className="provider-group-search-title">SEARCH CELESTRAK GROUP CATALOG</div>
        <form className="provider-group-search" onSubmit={(event) => void searchProviderGroups(event)}>
          <input value={groupSearch} onChange={(event) => { setGroupSearch(event.target.value); setProviderSearchDone(false); }} placeholder="Starlink, Galileo, Planet, Spire…" aria-label="Search provider groups"/>
          <button type="submit" disabled={busy || searching || groupSearch.trim().length < 2}>{searching ? "SEARCH…" : "SEARCH"}</button>
        </form>
        {providerSearchResults.map(providerRow)}
        {providerSearchDone && providerSearchResults.length === 0 && <div className="provider-group-search-empty">NO MATCHING CELESTRAK GROUPS</div>}
        {providerNotice && <div className="provider-group-notice">{providerNotice}</div>}
      </section>

      <form className="group-create" onSubmit={create}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New group name" aria-label="New group name"/>
        <select value={groupType} onChange={(event) => setGroupType(event.target.value as SatelliteGroupType)} aria-label="Group type">
          <option value="custom">CUSTOM</option><option value="mission">MISSION</option><option value="constellation">CONSTELLATION</option>
        </select>
        <button type="submit" disabled={busy || !name.trim()}>CREATE</button>
      </form>

      {error && <div className="group-error">{error}</div>}

      <div className="group-list">
        {groups.length === 0 && <div className="group-empty">NO GROUPS DEFINED</div>}
        {groups.map((group) => {
          const displayed = displayedGroupId === group.id;
          const expandedRow = expandedId === group.id;
          return (
            <div className={`group-entry ${expandedRow ? "expanded" : ""}`} key={group.id}>
              <div className="group-row">
                <button className="group-expand" type="button" onClick={() => toggleExpanded(group.id, expandedRow)} aria-expanded={expandedRow}>
                  <strong>{group.name}</strong><small>{group.group_type.toUpperCase()} · {group.active_member_count}/{group.member_count} ACTIVE · {group.source.toUpperCase()}</small>
                </button>
                <button className={displayed ? "visible" : ""} type="button" disabled={displayed} onClick={() => onDisplayGroup(group.id)}>{displayed ? "DISPLAYING" : "DISPLAY"}</button>
                {group.source === "user" && <button type="button" disabled={busy} onClick={() => void rename(group)}>RENAME</button>}
                {group.source === "user" && <button className="group-delete" type="button" disabled={busy || displayed} onClick={() => void removeGroup(group)}>DELETE</button>}
              </div>

              {expandedRow && (
                <div className="group-members">
                  {group.source === "user" && (
                    <div className="group-add-member">
                      <select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} aria-label="Satellite to add to group">
                        <option value="">ADD SATELLITE…</option>
                        {candidates.map((satellite) => <option key={satellite.id} value={satellite.id}>{satellite.name} · NORAD {satellite.norad_id ?? "—"}</option>)}
                      </select>
                      <button type="button" onClick={() => void addMember()} disabled={busy || !candidateId}>ADD</button>
                    </div>
                  )}
                  {members.length === 0 && <div className="group-empty">NO MEMBERS</div>}
                  {members.map((member) => (
                    <div className="group-member-row" key={member.id}>
                      <span className={member.active ? "active" : "inactive"}/>
                      <button type="button" className="group-member-select" disabled={!member.norad_id} onClick={() => member.norad_id && onSelectSatellite(member.norad_id)}>
                        <strong>{member.name}</strong><small>NORAD {member.norad_id ?? "—"}</small>
                      </button>
                      {group.source === "user" && <button type="button" disabled={busy} onClick={() => void removeMember(member)}>REMOVE</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="group-note">DISPLAYING A GROUP REPLACES THE SINGLE-OBJECT VIEW. INACTIVE MEMBERS ARE TEMPORARILY PROPAGATED FOR DISPLAY WITHOUT CHANGING MONITORING STATE.</div>
    </aside>
  );
}
