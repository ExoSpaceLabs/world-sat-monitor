# Orbit and environment display

WorldSat Monitor v1 has two mutually exclusive display modes, **Single** and **Group**, backed by different rendering workloads but the same persisted orbital state and globe projection.

## Display-mode model

The top-level controls separate viewing from configuration:

```text
[ Single | Group ]   [ Details ]   [ Manager ]   [ Orbital Settings ]   [ Map Settings ]
```

`Single` and `Group` select the displayed target class. `Details` follows the current target. Manager and settings panels do not redefine the target model.

## Single mode

Single mode displays one selected active satellite in detail.

### Satellite marker

The selected satellite uses a MapLibre marker whose geographic anchor remains the satellite subpoint while its visual position is projected to the configured orbital/surface altitude.

The marker supports:

- spacecraft name;
- heading and altitude label;
- selected state;
- Earth occlusion;
- street-map contrast treatment;
- camera-follow selection.

When the spacecraft is behind Earth, visibility is determined using a finite camera-to-satellite ray/sphere test. The marker is dimmed/occluded consistently rather than allowed to flicker around the limb.

### History and prediction

Detailed trajectory rendering uses the custom WebGL `OrbitTrackLayer`.

The API supplies stored propagated points around the selected time. The frontend divides them into:

- **history**, rendered as a solid trajectory;
- **prediction**, rendered with a physical-distance dash pattern;
- **heading vector**, rendered independently from trajectory history/prediction.

The current spacecraft position joins the history and prediction paths so the rendered line remains continuous through the selected state.

### Ground versus orbit placement

Single orbital settings support two path placement modes:

- **GROUND**: path geometry is placed at Earth surface elevation;
- **ORBIT**: path and marker preserve propagated altitude above the globe.

ORBIT mode uses MapLibre's 3D projection/depth-aware path so the globe can physically occlude trajectory segments on the far side.

### Path time window

The UI requests only the configured detailed window around the selected satellite, not the full stored propagation horizon. History/prediction durations and requested resolution are frontend settings; the backend decimates stored samples accordingly.

The effective returned resolution may be coarser than requested if required to respect API point limits.

### Follow satellite

`FOLLOW SATELLITE` locks the camera to the selected spacecraft while Earth continues to rotate according to simulation time. Switching selected satellite or switching to Group mode disables the existing follow state.

## Group mode

Group mode is optimized for current situational awareness rather than thousands of detailed trajectories.

A selected collection may represent:

- a provider constellation;
- a custom group;
- a mission group.

The frontend requests a batched current-position product and renders all available members into one canvas overlay.

### Why group markers are batched

Thousands of individual MapLibre/DOM markers would create needless layout/event overhead. Group rendering instead prepares the visible member set once and draws compact markers into a single browser canvas.

The renderer:

- projects each current member through the globe projection;
- applies Earth occlusion;
- clips markers outside the viewport;
- draws active/inactive presentation;
- optionally draws direction vectors;
- optionally draws spacecraft names;
- keeps a projected-point index for hover/click hit testing.

Clicking a group member selects that satellite and transitions to detailed Single display.

### Group orbital settings

Group settings are intentionally separate from Single settings. They control collection-oriented presentation such as:

- marker placement at ground or orbital altitude;
- direction-vector visibility;
- satellite-name visibility;
- group refresh behavior/prediction request parameters used by the group display lease.

Detailed per-object history/prediction is not drawn for every group member. A constellation of several thousand satellites does not need several thousand simultaneous historical spaghetti trails to prove that software can consume a GPU.

## Details panel

Details is independent from the Single/Group list panel and follows the selected target.

### Satellite Details

Single Details contains current display information including:

- altitude;
- heading;
- latitude;
- longitude;
- active basemap;
- propagated/interpolated state;
- orbital source;
- illumination state;
- follow control.

### Group Details

Group Details contains aggregate information including:

- members;
- active members;
- positions ready;
- coverage percentage;
- collection type;
- source/source key;
- average altitude;
- altitude range;
- last synchronization time.

The Single and Group list panels use the same width/docking geometry so opening Details never covers the active display list.

## Simulation time and Earth rotation

WorldSat Monitor maintains a simulation clock anchored to real time plus a configurable time-scale factor.

At normal speed:

```text
simulation UTC ~= real UTC
```

At accelerated speed, Earth rotation and solar/environment state advance consistently with the simulation clock.

Resetting simulation time returns the anchor to current real UTC while preserving the chosen time scale.

Camera manipulation and Earth rotation are separate concepts. Dragging changes the camera; it does not stop the UTC Earth rotation model.

## Space background

When the environment is enabled, the viewport includes an inertial-style star/sun background behind the MapLibre globe.

The intended layering is:

```text
page controls
satellite/group overlays
orbit rendering
night illumination
MapLibre Earth
space background
```

The background is not a basemap and does not rotate as if painted onto Earth.

## Solar state

Solar geometry is calculated from simulation UTC and expressed as the current subsolar latitude/longitude plus inertial solar information used by scene rendering.

That state drives:

- visible sun/background orientation;
- day/night surface illumination;
- satellite illumination reporting in Details.

## Day/night illumination

The night hemisphere is rendered by a custom MapLibre WebGL layer.

The vertex shader uses MapLibre's projection helpers and a globe tile mesh. Surface normals are compared with the ECEF sun vector:

```text
illumination = dot(surface_normal, sun_direction)
```

A narrow smooth transition is applied around the terminator. The night-side alpha is then scaled by the user-configured shadow opacity.

The layer participates in MapLibre's **3D render pass** so it remains installed/renderable independently from the Single satellite orbit layer. While drawing the surface-darkening pass it disables depth/stencil/culling and uses alpha blending, because the operation is intended to darken the rendered globe surface rather than become independent 3D geometry.

This is important in Group mode, where the detailed Single `OrbitTrackLayer` is not mounted.

## Shadow opacity

Map Settings exposes night-shadow opacity. The default is defined in application settings and reset with the rest of the map defaults.

Opacity changes only visualization. It does not affect computed solar state or satellite illumination classification.

## Basemap interaction

The same satellite/group geometry is used on all three basemaps:

- Dark;
- Street;
- Satellite.

Street mode applies stronger surface contrast to detailed orbital graphics. Group markers retain their compact active/inactive presentation.

See [basemap-contrast.md](basemap-contrast.md).

## Debug telemetry

Scene debug mode exposes useful renderer state including:

- simulation UTC and time scale;
- display mode;
- Earth rotation;
- map projection;
- subsolar longitude;
- camera/sun delta;
- shadow renderer readiness and mesh size;
- orbit renderer readiness/shader/vertex counts;
- group marker count;
- selected satellite altitude/path resolution.

The overlay exists for renderer validation and should not become a replacement for application-level Details.

## Persistence

Map/orbit settings are persisted through the backend with a short UI debounce. Single and Group orbital settings remain separate so changing a collection presentation does not silently rewrite the selected-satellite path configuration.

## Rendering principle

WorldSat Monitor keeps physical/model state separate from presentation:

- backend: orbital acquisition, propagation, stored state;
- frontend domain: selected target and display settings;
- MapLibre/custom layers: projection and rendering;
- panels: navigation/inspection/management.

That boundary is what allows the same future orbit or telemetry source to feed either a detailed spacecraft view or a constellation display without duplicating the orbital model in browser code.
