import type {StyleSpecification} from "maplibre-gl";
import type {Basemap} from "../domain/types";

const OPENFREEMAP_DARK_STYLE_URL = "/map/openfreemap/styles/dark";
const ESRI_DARK_BASE_TILES = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const ESRI_DARK_REFERENCE_TILES = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const OSM_STANDARD_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Derived from the UI cyan accent, but intentionally much darker so map detail
// stays subordinate to satellite/orbit overlays. The grayscale Esri base is
// blended over this color: brighter land lifts toward cyan while dark water
// remains close to this deep background tone.
const DARK_MAP_SURFACE = "#06272d";

type MutableStyleLayer = {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
};

async function loadOpenFreeMapDarkStyle(): Promise<StyleSpecification> {
  const response = await fetch(OPENFREEMAP_DARK_STYLE_URL);
  if (!response.ok) throw new Error(`OpenFreeMap dark style unavailable (${response.status})`);
  const style = await response.json() as StyleSpecification;
  style.projection = {type: "globe"};
  return style;
}

export async function loadBasemapStyle(mode: Basemap): Promise<StyleSpecification> {
  if (mode === "dark") return darkRasterStyle();

  if (mode === "street") {
    return rasterStyle("osm-standard", [OSM_STANDARD_TILES], 19, "© OpenStreetMap contributors");
  }

  const style = await loadOpenFreeMapDarkStyle();
  style.sources = {
    "satellite-imagery": {
      type: "raster",
      tiles: [SATELLITE_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Tiles © Esri and data providers",
    },
    ...style.sources,
  };
  style.layers = [
    {id: "satellite-imagery", type: "raster", source: "satellite-imagery"},
    ...style.layers.map((rawLayer) => {
      const layer = rawLayer as MutableStyleLayer;
      if (layer.type !== "background" && layer.type !== "fill" && layer.type !== "fill-extrusion") return rawLayer;
      return {...rawLayer, layout: {...rawLayer.layout, visibility: "none" as const}};
    }),
  ];
  return style;
}

export function fallbackStyle(): StyleSpecification {
  return rasterStyle("osm-fallback", [OSM_STANDARD_TILES], 19, "© OpenStreetMap contributors");
}

function darkRasterStyle(): StyleSpecification {
  return {
    version: 8,
    projection: {type: "globe"},
    sources: {
      "esri-dark-base": {
        type: "raster",
        tiles: [ESRI_DARK_BASE_TILES],
        tileSize: 256,
        maxzoom: 16,
        attribution: "Tiles © Esri and data providers",
      },
      "esri-dark-reference": {
        type: "raster",
        tiles: [ESRI_DARK_REFERENCE_TILES],
        tileSize: 256,
        maxzoom: 16,
        attribution: "Tiles © Esri and data providers",
      },
    },
    layers: [
      {
        id: "worldsat-dark-surface",
        type: "background",
        paint: {"background-color": DARK_MAP_SURFACE},
      },
      {
        id: "esri-dark-base",
        type: "raster",
        source: "esri-dark-base",
        paint: {
          "raster-opacity": 0.42,
          "raster-saturation": -1,
          "raster-contrast": 0.2,
          "raster-brightness-min": 0,
          "raster-brightness-max": 0.58,
        },
      },
      {
        id: "esri-dark-reference",
        type: "raster",
        source: "esri-dark-reference",
        paint: {
          "raster-opacity": 0.82,
          "raster-saturation": -0.35,
          "raster-contrast": 0.08,
          "raster-brightness-max": 0.86,
        },
      },
    ],
  };
}

function rasterStyle(id: string, tiles: string[], maxzoom: number, attribution: string): StyleSpecification {
  return {
    version: 8,
    projection: {type: "globe"},
    sources: {
      [id]: {type: "raster", tiles, tileSize: 256, maxzoom, attribution},
    },
    layers: [{id, type: "raster", source: id}],
  };
}
