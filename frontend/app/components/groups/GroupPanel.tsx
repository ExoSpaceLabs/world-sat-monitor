"use client";

import {useMemo} from "react";
import type {SatelliteGroup} from "../../domain/satellite";

type GroupPanelProps = {
  groups: SatelliteGroup[];
  displayedGroupId: number | null;
  onDisplayGroup: (groupId: number) => void;
  onClose: () => void;
};

function GroupSection({
  title,
  groups,
  displayedGroupId,
  onDisplayGroup,
}: {
  title: string;
  groups: SatelliteGroup[];
  displayedGroupId: number | null;
  onDisplayGroup: (groupId: number) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <section className="group-display-section">
      <div className="group-display-title">{title}</div>
      {groups.map((group) => {
        const displayed = group.id === displayedGroupId;
        return (
          <button
            className={`group-display-row ${displayed ? "displayed" : ""}`}
            type="button"
            key={group.id}
            onClick={() => onDisplayGroup(group.id)}
            aria-pressed={displayed}
          >
            <span><strong>{group.name}</strong><small>{group.group_type.toUpperCase()} · {group.active_member_count}/{group.member_count} ACTIVE</small></span>
            <em>{displayed ? "DISPLAYING" : "DISPLAY"}</em>
          </button>
        );
      })}
    </section>
  );
}

export function GroupPanel({groups, displayedGroupId, onDisplayGroup, onClose}: GroupPanelProps) {
  const constellations = useMemo(
    () => groups.filter((group) => group.group_type === "constellation"),
    [groups],
  );
  const customGroups = useMemo(
    () => groups.filter((group) => group.group_type !== "constellation"),
    [groups],
  );

  return (
    <aside className="group-panel group-display-panel" aria-label="Group display list">
      <div className="group-panel-head">
        <div><small>DISPLAY COLLECTIONS</small><strong>GROUP</strong></div>
        <button type="button" onClick={onClose} aria-label="Close group list">×</button>
      </div>
      {groups.length === 0 && <div className="group-empty">NO GROUPS DEFINED · USE MANAGER TO ADD ONE</div>}
      <GroupSection title="CONSTELLATIONS" groups={constellations} displayedGroupId={displayedGroupId} onDisplayGroup={onDisplayGroup}/>
      <GroupSection title="CUSTOM + MISSION GROUPS" groups={customGroups} displayedGroupId={displayedGroupId} onDisplayGroup={onDisplayGroup}/>
      <div className="group-note">SEARCH, IMPORT, CREATION AND MEMBERSHIP EDITING LIVE IN MANAGER.</div>
    </aside>
  );
}
