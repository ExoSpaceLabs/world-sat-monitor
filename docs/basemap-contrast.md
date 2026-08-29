# Basemap and contrast policy

WorldSat Monitor v1 provides three MapLibre globe basemaps. Satellite/orbit rendering adapts to the selected surface so tracking graphics remain readable without tying orbital semantics to one cartographic style.

## Basemap modes

### Dark

Dark is the default engineering view.

It uses:

- Esri `World_Dark_Gray_Base` raster tiles;
- Esri `World_Dark_Gray_Reference` raster tiles;
- a configurable WorldSat surface base color;
- desaturation, brightness, opacity, and contrast treatment in MapLibre.

The WorldSat surface background is always present, so a temporarily missing raster tile does not turn the globe into an unstyled transparent object.

Dark mode does not require a client API key.

### Street

Street mode uses OpenStreetMap standard raster tiles:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

The style remains globe-projected. Satellite/orbit presentation switches to stronger dark/light contrast because the underlying surface can be much brighter than the default dark map.

### Satellite

Satellite mode uses Esri World Imagery as the surface and loads the OpenFreeMap dark style through the WorldSat gateway for label/symbol data. Background/fill/line layers from that vector style are hidden, leaving useful labels/symbols over the imagery.

This avoids presenting a second opaque cartographic surface over the imagery while keeping geographic context.

## Fallback behavior

If the requested style cannot be loaded, WorldSat Monitor can fall back to an OpenStreetMap raster globe rather than leaving the map unusable.

External tile/provider availability is therefore a visualization dependency, not a backend orbital-service dependency. Provider/propagator/API health remains separate from basemap availability.

## Attribution

The UI displays attribution for the active map source.

Current sources include:

- Esri and its data providers for Dark/Satellite imagery;
- OpenStreetMap contributors for Street/fallback data;
- OpenFreeMap-derived overlays in Satellite mode.

Do not remove or obscure provider attribution when changing map layout.

## Orbital graphic contrast

WorldSat orbital graphics are semantic overlays and should remain recognizable across basemaps.

### Dark / Satellite-style surfaces

The normal space palette is used:

- active/selected satellite markers use the WorldSat green/cyan accent;
- history uses a solid path;
- prediction uses a dashed path;
- heading/direction vectors remain distinct from trajectory segments;
- group members use compact luminous markers;
- occluded detailed satellites are dimmed rather than allowed to flicker.

### Street surface

A bright street map can make the normal luminous palette disappear into roads, labels, or coastlines. The single-satellite marker and WebGL orbit renderer therefore choose a high-contrast surface treatment when the projected geometry overlaps Earth.

When the same geometry is visually over space rather than the map surface, the normal space palette is retained.

This is a presentation rule only. It does not alter satellite state or path geometry.

## Group rendering

Group display uses one canvas overlay for the current-state members of the selected collection. Each member is projected through the same MapLibre globe transformation/occlusion helpers used elsewhere in the frontend.

Group markers therefore remain a single batched render workload even for large constellations. Names and direction vectors are optional Group orbital settings because drawing them for thousands of members is both visually noisy and computationally unnecessary.

## Day/night environment interaction

The space environment is independent from basemap choice.

When enabled, it adds:

- inertial stars/sun background;
- Earth rotation based on simulation UTC/time scale;
- a custom WebGL day/night illumination pass over the globe.

The day/night layer darkens the night hemisphere by blending black with configurable opacity. It does not replace the basemap, and it is rendered in the globe 3D pass so the effect remains present in both Single and Group display modes.

The default shadow opacity is defined by application settings and can be changed/reset from Map Settings.

## Theme controls

Dark mode exposes a themed base color and contrast parameter. These controls affect cartographic presentation only. They do not alter:

- orbital source data;
- satellite/group membership;
- propagation;
- solar geometry;
- trajectory sampling.

## Design rule

Basemap code should answer only:

> What Earth surface/context should the user see, and how should overlays remain legible on it?

It should not become responsible for orbital state, group lifecycle, provider acquisition, or propagation. Keeping those concerns separate prevents a failed tile source from becoming, through the usual miracles of software entropy, a failed satellite tracker.
