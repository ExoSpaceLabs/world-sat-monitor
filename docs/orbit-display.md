# Orbit display rendering

This document describes the frontend orbit-rendering modes and the persistent settings that control them.

## Display modes

```mermaid
flowchart LR
    S[(propagated samples<br/>lat / lon / altitude)] --> R[MapLibre custom orbit overlay]
    C[/global orbit settings/] --> R
    R -->|GROUND| G[nadir-projected history/prediction<br/>elevation = 0]
    R -->|ORBIT| O[elevated history/prediction<br/>elevation = sample altitude]
    C -->|direction_vector_enabled| D[current direction vector]
```

`GROUND` shows where the satellite path projects onto the Earth surface. `ORBIT` keeps the propagated altitude and sends it through MapLibre's globe-aware `projectTileWithElevation` projection path.

The orbit renderer is intentionally a **2D custom overlay layer with elevated vertices**, not a depth-sharing 3D custom layer. The path must remain readable above the basemap while still using MapLibre's globe projection and horizon clipping.

The direction vector is independent of path visibility. Disabling `DRAW ORBIT PATHS` hides history and prediction while `DRAW DIRECTION VECTOR` may remain enabled.

## Projection pipeline

The orbit path is no longer projected into screen coordinates by application code.

```mermaid
flowchart TD
    P[track samples<br/>lat / lon / altitude] --> D[densify great-circle segments<br/>max 1 degree]
    D --> N[normalize longitude]
    N --> X{dateline crossing?}
    X -->|yes| S[split line strip]
    X -->|no| M[keep same strip]
    S --> C[Mercator world x/y]
    M --> C
    C --> T[convert x/y to tile 0 coordinates<br/>0..EXTENT]
    T --> E[attach elevation in physical metres]
    E --> V[WebGL vertex buffer]
    V --> PDATA[args.getProjectionData<br/>tile 0/0/0]
    PDATA --> Q[projectTileWithElevation]
    Q --> G{active MapLibre projection}
    G -->|Globe| GL[sphere projection + horizon clipping]
    G -->|Mercator| MC[Mercator camera projection]
    GL --> F[history / prediction / heading]
    MC --> F
```

The orbit renderer deliberately uses the same projection contract as the existing day/night shadow layer: tile-local geometry for the base `0/0/0` tile plus projection data obtained through `args.getProjectionData(...)`.

For this contract, elevation is supplied in **physical metres**. MapLibre's Mercator custom-layer matrix rescales its Z axis by `worldSize / pixelsPerMeter`, while the globe shader converts elevation metres into radius above the unit sphere. Application code therefore does not maintain a second conformal-Z representation.

The previous screen-space renderer projected each point to 2D and then simulated altitude by moving that pixel radially away from the apparent globe centre. That approximation caused close-zoom spurious lines and ORBIT paths that bent around the camera focus point. That code path is no longer used.

Backend samples are subdivided for rendering along great-circle arcs so consecutive custom-layer vertices are never more than roughly one angular degree apart. This is display-only interpolation. It does not alter the stored propagation cadence or create new authoritative orbit states.

Dateline crossings are split before drawing because normalized world-Mercator x wraps from 1 back to 0 there. Prediction and direction-vector dash patterns use cumulative physical path distance rather than screen pixels, so their logical cadence does not change with zoom.

## Runtime diagnostics

`OrbitTrackLayer` reports whether the custom layer has reached a successful draw, which shader projection variant is active, how many vertices exist in each geometry set, and the latest WebGL/shader error if rendering fails. This prevents a failed custom layer from degenerating into an unexplained empty display.

## Rendering ownership

```mermaid
flowchart LR
    API[backend track API] --> UI[WorldSatMonitor state]
    UI --> SAT[SatelliteLayer]
    SAT --> MARKER[HTML satellite marker]
    SAT --> TRACK[OrbitTrackLayer<br/>MapLibre custom WebGL overlay]
    SETTINGS[Orbit Settings] --> SAT
    TRACK --> MAP[MapLibre projection + render frame]
```

Orbital data remains owned by the backend. The frontend custom layer only decides how the already-propagated state is visualized.

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
