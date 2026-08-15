# Orbit display rendering

This document describes the frontend orbit-overlay modes and the persistent settings that control them.

## Display modes

```mermaid
flowchart LR
    S[(propagated samples<br/>lat / lon / altitude)] --> R[orbit overlay renderer]
    C[/global orbit settings/] --> R
    R -->|GROUND| G[nadir-projected history/prediction<br/>altitude forced to 0]
    R -->|ORBIT| O[3D-looking history/prediction<br/>sample altitude applied]
    C -->|direction_vector_enabled| D[current direction vector]
```

`GROUND` shows where the satellite path projects onto the Earth surface. `ORBIT` uses each propagated sample's altitude and the same rendered-altitude model used by the satellite marker, so the marker and track remain visually aligned.

The direction vector is independent of path visibility. Disabling `DRAW ORBIT PATHS` hides history and prediction while `DRAW DIRECTION VECTOR` may remain enabled.

## Zoom-safe overlay rendering

The orbit overlay is an SVG layer projected from geographic samples on every map render.

```mermaid
flowchart TD
    P[track point] --> N[normalize longitude]
    N --> V{close zoom?}
    V -->|yes| L[let viewport clipping handle visibility]
    V -->|no| H[apply globe far-side occlusion]
    L --> M{track mode}
    H --> M
    M -->|GROUND| Z[project nadir point]
    M -->|ORBIT| A[project nadir + altitude offset]
    Z --> D[append SVG path segment]
    A --> D
```

Screen-space distance is deliberately not used to decide whether consecutive samples are discontinuous. At close zoom a valid 60-second sample interval can span more than the viewport width; treating that as a jump caused the renderer to lift the pen repeatedly and made paths disappear. Dateline crossings and globe far-side occlusion are the only geometric discontinuities applied.

## Persistent settings

Settings schema version 3 adds the orbit placement mode and direction-vector visibility:

```json
{
  "version": 3,
  "orbit": {
    "direction_vector_enabled": true,
    "position_update_ms": 1000,
    "path": {
      "enabled": true,
      "mode": "ground",
      "history_minutes": 90,
      "prediction_hours": 6,
      "resolution_seconds": 60,
      "refresh_seconds": 30
    }
  }
}
```

Version 1 and version 2 settings are migrated automatically. Existing path/update values are retained; new fields default to `direction_vector_enabled=true` and `mode="ground"`.
