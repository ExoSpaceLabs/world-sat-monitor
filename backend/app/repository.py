from __future__ import annotations

from datetime import datetime
import math
from typing import Any, Iterable

from psycopg.types.json import Jsonb


SATELLITE_SELECT = """
    SELECT s.id, s.name, s.active, s.object_type, s.provider_preference,
           s.metadata, s.created_at, s.updated_at,
           COALESCE(jsonb_object_agg(si.namespace, si.value) FILTER (WHERE si.namespace IS NOT NULL), '{}'::jsonb) AS identifiers
    FROM satellites s
    LEFT JOIN satellite_identifiers si ON si.satellite_id = s.id
"""
GROUP_SELECT = """
    SELECT g.id, g.name, g.group_type, g.source, g.source_key, g.metadata,
           g.created_at, g.updated_at,
           COUNT(gm.satellite_id)::int AS member_count,
           COUNT(gm.satellite_id) FILTER (WHERE s.active)::int AS active_member_count
    FROM satellite_groups g
    LEFT JOIN satellite_group_members gm ON gm.group_id = g.id
    LEFT JOIN satellites s ON s.id = gm.satellite_id
"""


def _with_norad_identifier(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    identifiers = dict(result.get("identifiers") or {})
    result["identifiers"] = identifiers
    result["norad_id"] = identifiers.get("NORAD_CAT_ID")
    return result


def _with_current_position_identifier(row: dict[str, Any]) -> dict[str, Any]:
    result = dict(row)
    norad_id = result.get("norad_id")
    result["identifiers"] = {"NORAD_CAT_ID": norad_id} if norad_id else {}
    return result


def list_satellites(connection, active: bool | None = None) -> list[dict[str, Any]]:
    where = "" if active is None else "WHERE s.active = %s"
    params: tuple[Any, ...] = () if active is None else (active,)
    rows = connection.execute(f"""{SATELLITE_SELECT} {where} GROUP BY s.id ORDER BY s.name, s.id""", params).fetchall()
    return [_with_norad_identifier(row) for row in rows if row is not None]


def get_satellite(connection, satellite_id: int) -> dict[str, Any] | None:
    row = connection.execute(f"""{SATELLITE_SELECT} WHERE s.id = %s GROUP BY s.id""", (satellite_id,)).fetchone()
    return _with_norad_identifier(row)


def get_satellite_by_norad(connection, norad_id: str | int) -> dict[str, Any] | None:
    row = connection.execute(f"""
        {SATELLITE_SELECT}
        WHERE EXISTS (SELECT 1 FROM satellite_identifiers lookup WHERE lookup.satellite_id = s.id AND lookup.namespace = 'NORAD_CAT_ID' AND lookup.value = %s)
        GROUP BY s.id
    """, (str(norad_id),)).fetchone()
    return _with_norad_identifier(row)


def _replace_identifiers(connection, satellite_id: int, identifiers: Iterable[Any]) -> None:
    connection.execute("DELETE FROM satellite_identifiers WHERE satellite_id = %s", (satellite_id,))
    for identifier in identifiers:
        namespace = identifier.namespace if hasattr(identifier, "namespace") else identifier["namespace"]
        value = identifier.value if hasattr(identifier, "value") else identifier["value"]
        connection.execute("INSERT INTO satellite_identifiers (satellite_id, namespace, value) VALUES (%s, %s, %s)", (satellite_id, namespace, value))


def create_satellite(connection, value: Any) -> dict[str, Any]:
    row = connection.execute("""
        INSERT INTO satellites (name, active, object_type, provider_preference, metadata)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
    """, (value.name, value.active, value.object_type, value.provider_preference, Jsonb(value.metadata))).fetchone()
    satellite_id = int(row["id"])
    _replace_identifiers(connection, satellite_id, value.identifiers)
    created = get_satellite(connection, satellite_id)
    if created is None:
        raise RuntimeError("created satellite could not be reloaded")
    return created


def update_satellite(connection, satellite_id: int, changes: dict[str, Any]) -> dict[str, Any] | None:
    identifiers = changes.pop("identifiers", None) if "identifiers" in changes else None
    assignments: list[str] = []
    params: list[Any] = []
    column_map = {"name": "name", "object_type": "object_type", "provider_preference": "provider_preference", "metadata": "metadata"}
    for field, column in column_map.items():
        if field not in changes:
            continue
        assignments.append(f"{column} = %s")
        value = changes[field]
        params.append(Jsonb(value) if field == "metadata" else value)
    if assignments:
        assignments.append("updated_at = NOW()")
        params.append(satellite_id)
        updated = connection.execute(f"UPDATE satellites SET {', '.join(assignments)} WHERE id = %s RETURNING id", tuple(params)).fetchone()
        if updated is None:
            return None
    elif get_satellite(connection, satellite_id) is None:
        return None
    if identifiers is not None:
        _replace_identifiers(connection, satellite_id, identifiers)
        connection.execute("UPDATE satellites SET updated_at = NOW() WHERE id = %s", (satellite_id,))
    return get_satellite(connection, satellite_id)


def set_satellite_active(connection, satellite_id: int, active: bool) -> dict[str, Any] | None:
    row = connection.execute("UPDATE satellites SET active = %s, updated_at = NOW() WHERE id = %s RETURNING id", (active, satellite_id)).fetchone()
    if row is None:
        return None
    return get_satellite(connection, satellite_id)


def delete_satellite(connection, satellite_id: int) -> bool:
    return connection.execute("DELETE FROM satellites WHERE id = %s RETURNING id", (satellite_id,)).fetchone() is not None


def list_groups(connection) -> list[dict[str, Any]]:
    return list(connection.execute(f"""{GROUP_SELECT} GROUP BY g.id ORDER BY g.name, g.id""").fetchall())


def get_group(connection, group_id: int) -> dict[str, Any] | None:
    return connection.execute(f"""{GROUP_SELECT} WHERE g.id = %s GROUP BY g.id""", (group_id,)).fetchone()


def create_group(connection, value: Any) -> dict[str, Any]:
    row = connection.execute("INSERT INTO satellite_groups (name, group_type, source, metadata) VALUES (%s, %s, 'user', %s) RETURNING id", (value.name, value.group_type, Jsonb(value.metadata))).fetchone()
    created = get_group(connection, int(row["id"]))
    if created is None:
        raise RuntimeError("created satellite group could not be reloaded")
    return created


def update_group(connection, group_id: int, changes: dict[str, Any]) -> dict[str, Any] | None:
    assignments: list[str] = []
    params: list[Any] = []
    for field in ("name", "group_type", "metadata"):
        if field not in changes:
            continue
        assignments.append(f"{field} = %s")
        params.append(Jsonb(changes[field]) if field == "metadata" else changes[field])
    if assignments:
        assignments.append("updated_at = NOW()")
        params.append(group_id)
        row = connection.execute(f"UPDATE satellite_groups SET {', '.join(assignments)} WHERE id = %s RETURNING id", tuple(params)).fetchone()
        if row is None:
            return None
    elif get_group(connection, group_id) is None:
        return None
    return get_group(connection, group_id)


def delete_group(connection, group_id: int) -> bool:
    return connection.execute("DELETE FROM satellite_groups WHERE id = %s RETURNING id", (group_id,)).fetchone() is not None


def list_group_members(connection, group_id: int) -> list[dict[str, Any]]:
    rows = connection.execute("""
        SELECT s.id, s.name, s.active, s.object_type, s.provider_preference, s.metadata, s.created_at, s.updated_at,
               gm.metadata AS membership_metadata, gm.added_at,
               COALESCE((SELECT jsonb_object_agg(si.namespace, si.value) FROM satellite_identifiers si WHERE si.satellite_id = s.id), '{}'::jsonb) AS identifiers
        FROM satellite_group_members gm JOIN satellites s ON s.id = gm.satellite_id
        WHERE gm.group_id = %s ORDER BY s.name, s.id
    """, (group_id,)).fetchall()
    return [_with_norad_identifier(row) for row in rows if row is not None]


def add_group_member(connection, group_id: int, satellite_id: int, metadata: dict[str, Any] | None = None) -> dict[str, Any] | None:
    connection.execute("""
        INSERT INTO satellite_group_members (group_id, satellite_id, metadata) VALUES (%s, %s, %s)
        ON CONFLICT (group_id, satellite_id) DO UPDATE SET metadata = EXCLUDED.metadata
    """, (group_id, satellite_id, Jsonb(metadata or {})))
    return next((row for row in list_group_members(connection, group_id) if row["id"] == satellite_id), None)


def remove_group_member(connection, group_id: int, satellite_id: int) -> bool:
    return connection.execute("DELETE FROM satellite_group_members WHERE group_id = %s AND satellite_id = %s RETURNING satellite_id", (group_id, satellite_id)).fetchone() is not None


def get_group_current_positions(connection, group_id: int, active_only: bool = False, limit: int = 10000) -> list[dict[str, Any]]:
    rows = connection.execute("""
        SELECT s.id, s.name, s.active, norad.value AS norad_id,
               scs.state_time, scs.lat_deg, scs.lon_deg, scs.altitude_km,
               scs.source_run_id, scs.source_element_set_id
        FROM satellite_group_members gm
        JOIN satellites s ON s.id = gm.satellite_id
        JOIN satellite_current_state scs ON scs.satellite_id = s.id
        LEFT JOIN satellite_identifiers norad ON norad.satellite_id = s.id AND norad.namespace = 'NORAD_CAT_ID'
        WHERE gm.group_id = %s AND (%s = FALSE OR s.active)
        ORDER BY s.id LIMIT %s
    """, (group_id, active_only, limit)).fetchall()
    return [_with_current_position_identifier(row) for row in rows]


def get_group_positions_at(connection, group_id: int, at: datetime, active_only: bool = False, limit: int = 10000) -> list[dict[str, Any]]:
    rows = connection.execute("""
        SELECT s.id, s.name, s.active, norad.value AS norad_id,
               run.id AS source_run_id, run.source_element_set_id,
               before.sample_time AS before_time,
               before.x_ecef_km AS before_x_ecef_km,
               before.y_ecef_km AS before_y_ecef_km,
               before.z_ecef_km AS before_z_ecef_km,
               after.sample_time AS after_time,
               after.x_ecef_km AS after_x_ecef_km,
               after.y_ecef_km AS after_y_ecef_km,
               after.z_ecef_km AS after_z_ecef_km
        FROM satellite_group_members gm
        JOIN satellites s ON s.id = gm.satellite_id
        LEFT JOIN satellite_identifiers norad
          ON norad.satellite_id = s.id AND norad.namespace = 'NORAD_CAT_ID'
        JOIN LATERAL (
            SELECT id, source_element_set_id
            FROM propagation_runs
            WHERE satellite_id = s.id
              AND status = 'completed'
              AND start_time <= %s
              AND end_time >= %s
            ORDER BY generated_at DESC
            LIMIT 1
        ) run ON TRUE
        JOIN LATERAL (
            SELECT sample_time, x_ecef_km, y_ecef_km, z_ecef_km
            FROM position_samples
            WHERE run_id = run.id AND sample_time <= %s
            ORDER BY sample_time DESC
            LIMIT 1
        ) before ON TRUE
        JOIN LATERAL (
            SELECT sample_time, x_ecef_km, y_ecef_km, z_ecef_km
            FROM position_samples
            WHERE run_id = run.id AND sample_time >= %s
            ORDER BY sample_time ASC
            LIMIT 1
        ) after ON TRUE
        WHERE gm.group_id = %s AND (%s = FALSE OR s.active)
        ORDER BY s.id
        LIMIT %s
    """, (at, at, at, at, group_id, active_only, limit)).fetchall()
    return [_with_current_position_identifier(row) for row in rows]


def get_current_positions_for_selection(connection, satellite_ids: Iterable[int] = (), norad_ids: Iterable[str] = (), active_only: bool = True, limit: int = 10000) -> list[dict[str, Any]]:
    satellite_id_list = list(dict.fromkeys(int(value) for value in satellite_ids))
    norad_id_list = list(dict.fromkeys(str(value) for value in norad_ids))
    if not satellite_id_list and not norad_id_list:
        return []
    rows = connection.execute("""
        SELECT s.id, s.name, s.active, norad.value AS norad_id,
               scs.state_time, scs.lat_deg, scs.lon_deg, scs.altitude_km,
               scs.source_run_id, scs.source_element_set_id
        FROM satellites s
        JOIN satellite_current_state scs ON scs.satellite_id = s.id
        LEFT JOIN satellite_identifiers norad ON norad.satellite_id = s.id AND norad.namespace = 'NORAD_CAT_ID'
        WHERE ((cardinality(%s::bigint[]) > 0 AND s.id = ANY(%s::bigint[])) OR (cardinality(%s::text[]) > 0 AND norad.value = ANY(%s::text[])))
          AND (%s = FALSE OR s.active)
        ORDER BY s.id LIMIT %s
    """, (satellite_id_list, satellite_id_list, norad_id_list, norad_id_list, active_only, limit)).fetchall()
    return [_with_current_position_identifier(row) for row in rows]


def get_run_covering(connection, satellite_id: int, start: datetime, end: datetime) -> dict[str, Any] | None:
    return connection.execute("""
        SELECT id, satellite_id, source_element_set_id, generated_at, start_time, end_time,
               step_seconds, sampling_policy, status, is_mock
        FROM propagation_runs
        WHERE satellite_id = %s AND status = 'completed' AND start_time <= %s AND end_time >= %s
        ORDER BY generated_at DESC LIMIT 1
    """, (satellite_id, start, end)).fetchone()


def get_position_bracket(connection, run_id: str, at: datetime) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    before = connection.execute("""
        SELECT sample_time, x_ecef_km, y_ecef_km, z_ecef_km, lat_deg, lon_deg, altitude_km
        FROM position_samples WHERE run_id = %s AND sample_time <= %s ORDER BY sample_time DESC LIMIT 1
    """, (run_id, at)).fetchone()
    after = connection.execute("""
        SELECT sample_time, x_ecef_km, y_ecef_km, z_ecef_km, lat_deg, lon_deg, altitude_km
        FROM position_samples WHERE run_id = %s AND sample_time >= %s ORDER BY sample_time ASC LIMIT 1
    """, (run_id, at)).fetchone()
    return before, after


def get_track_points(connection, run_id: str, start: datetime, end: datetime, raw_step_seconds: int, resolution_seconds: int, max_points: int) -> tuple[list[dict[str, Any]], int]:
    duration_seconds = max(1, math.ceil((end - start).total_seconds()))
    size_limited_resolution = max(1, math.ceil(duration_seconds / max(1, max_points - 1)))
    effective_resolution_seconds = max(raw_step_seconds, resolution_seconds, size_limited_resolution)
    rows = connection.execute("""
        WITH bucketed AS (
            SELECT sample_time, lat_deg, lon_deg, altitude_km,
                   FLOOR(EXTRACT(EPOCH FROM (sample_time - %s::timestamptz)) / %s)::bigint AS sample_bucket
            FROM position_samples WHERE run_id = %s AND sample_time BETWEEN %s AND %s
        ), decimated AS (
            SELECT DISTINCT ON (sample_bucket) sample_time, lat_deg, lon_deg, altitude_km, sample_bucket
            FROM bucketed ORDER BY sample_bucket, sample_time
        )
        SELECT sample_time, lat_deg, lon_deg, altitude_km FROM decimated ORDER BY sample_time LIMIT %s
    """, (start, effective_resolution_seconds, run_id, start, end, max_points)).fetchall()
    return list(rows), effective_resolution_seconds


def get_prediction_errors(connection, run_id: str) -> list[dict[str, Any]]:
    return list(connection.execute("""
        SELECT horizon_day, mean_error_km, rms_error_km, p95_error_km, max_error_km, sample_count, evaluated_at, reference_kind
        FROM prediction_error_daily WHERE evaluated_run_id = %s ORDER BY horizon_day
    """, (run_id,)).fetchall())
