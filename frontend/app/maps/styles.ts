import type {StyleSpecification} from "maplibre-gl";
import {DEFAULT_THEMED_MAP_COLORS} from "../domain/settings";
import type {Basemap} from "../domain/types";

const OPENFREEMAP_DARK_STYLE_URL = "/map/openfreemap/styles/dark";
const MAPLIBRE_LAND_TILEJSON = "https://demotiles.maplibre.org/tiles/tiles.json";
const ESRI_DARK_REFERENCE_TILES = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const OSM_STANDARD_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export type ThemedMapColors = {
  water: string;
  land: string;
};

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

export async function loadBasemapStyle(
  mode: Basemap,
  themedColors: ThemedMapColors = DEFAULT_THEMED_MAP_COLORS,
): Promise<StyleSpecification> {
  if (mode === "dark") return themedMapStyle(themedColors);

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

function themedMapStyle(colors: ThemedMapColors): StyleSpecification {
  return {
    version: 8,
    projection: {type: "globe"},
    metadata: {
      "worldsat:theme-water": colors.water,
      "worldsat:theme-land": colors.land,
    },
    sources: {
      "maplibre-land": {
        type: "vector",
        url: MAPLIBRE_LAND_TILEJSON,
      },
      "esri-dark-reference": {
        type: "raster",
        tiles: [ESRI_DARK_REFERENCE_TILES],
        tileSize: 256,
        maxzoom: 16,
        attribution: "Reference tiles © Esri and data providers",
      },
    },
    layers: [
      {
        id: "worldsat-themed-water",
        type: "background",
        paint: {"background-color": colors.water},
      },
      {
        id: "worldsat-themed-land",
        type: "fill",
        source: "maplibre-land",
        "source-layer": "countries",
        paint: {
          "fill-color": colors.land,
          "fill-opacity": 1,
          "fill-outline-color": colors.land,
        },
      },
      {
        id: "esri-dark-reference",
        type: "raster",
        source: "esri-dark-reference",
        paint: {
          "raster-opacity": 0.86,
          "raster-saturation": -0.45,
          "raster-contrast": 0.06,
          "raster-brightness-max": 0.88,
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
