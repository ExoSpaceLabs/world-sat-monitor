import type {StyleSpecification} from "maplibre-gl";
import type {Basemap} from "../domain/types";

const OPENFREEMAP_DARK_STYLE_URL = "/map/openfreemap/styles/dark";
const ESRI_DARK_BASE_TILES = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const ESRI_DARK_REFERENCE_TILES = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const OSM_STANDARD_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// These are the exact top-menu button surfaces from world-sat-monitor/styles.css.
// The Esri source is raster, so it cannot assign these semantically to land and
// water. Instead the inactive surface is the exact globe background/water anchor,
// while the grayscale base is kept subtle enough that brighter land lifts toward
// the active surface without introducing a third, unrelated teal.
const MENU_INACTIVE_SURFACE = "#061720";
const MENU_ACTIVE_SURFACE = "#0a2734";

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
    metadata: {
      "worldsat:inactive-surface": MENU_INACTIVE_SURFACE,
      "worldsat:active-surface": MENU_ACTIVE_SURFACE,
    },
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
        paint: {"background-color": MENU_INACTIVE_SURFACE},
      },
      {
        id: "esri-dark-base",
        type: "raster",
        source: "esri-dark-base",
        paint: {
          "raster-opacity": 0.3,
          "raster-saturation": -1,
          "raster-contrast": 0.16,
          "raster-brightness-min": 0,
          "raster-brightness-max": 0.44,
        },
      },
      {
        id: "esri-dark-reference",
        type: "raster",
        source: "esri-dark-reference",
        paint: {
          "raster-opacity": 0.78,
          "raster-saturation": -0.45,
          "raster-contrast": 0.06,
          "raster-brightness-max": 0.82,
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
