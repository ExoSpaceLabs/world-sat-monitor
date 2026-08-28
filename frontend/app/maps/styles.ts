import type {StyleSpecification} from "maplibre-gl";
import type {Basemap} from "../domain/types";

const OPENFREEMAP_DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const OSM_STANDARD_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

type BasemapStyle = StyleSpecification | string;

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

export async function loadBasemapStyle(mode: Basemap): Promise<BasemapStyle> {
  // Keep OpenFreeMap's style URL intact for the normal dark map. Passing the
  // fetched JSON object to MapLibre detaches relative sprite/glyph/source URLs
  // from their stylesheet origin and can leave the vector basemap blank.
  if (mode === "dark") return OPENFREEMAP_DARK_STYLE_URL;

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
