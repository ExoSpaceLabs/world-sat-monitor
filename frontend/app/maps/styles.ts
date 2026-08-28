import type {StyleSpecification} from "maplibre-gl";
import {DEFAULT_THEMED_MAP_COLORS} from "../domain/settings";
import type {Basemap} from "../domain/types";

const OPENFREEMAP_DARK_STYLE_URL = "/map/openfreemap/styles/dark";
const ESRI_DARK_BASE_TILES = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
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

type Rgb = {r: number; g: number; b: number};

function parseHexColor(value: string): Rgb {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return {r: 0, g: 0, b: 0};
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function mixHex(left: string, right: string, rightWeight: number) {
  const a = parseHexColor(left);
  const b = parseHexColor(right);
  const weight = Math.max(0, Math.min(1, rightWeight));
  const channel = (start: number, end: number) => Math.round(start + (end - start) * weight)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

function brightness(value: string) {
  const {r, g, b} = parseHexColor(value);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

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
  if (mode === "dark") return themedRasterStyle(themedColors);

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

function themedRasterStyle(colors: ThemedMapColors): StyleSpecification {
  // Keep the exact renderer that previously proved reliable: a dark surface,
  // the Esri grayscale base for geography, and the Esri reference layer for
  // labels. The two user colors only tune that established blend. Water owns
  // most of the surface tone; land contributes to the surface hue and controls
  // the amount of luminance contrast exposed by the grayscale base.
  const waterBrightness = brightness(colors.water);
  const landBrightness = brightness(colors.land);
  const requestedContrast = Math.max(0, landBrightness - waterBrightness);
  const surface = mixHex(colors.water, colors.land, 0.22);
  const baseOpacity = Math.max(0.30, Math.min(0.50, 0.28 + requestedContrast * 1.4));
  const brightnessMax = Math.max(0.42, Math.min(0.64, 0.35 + landBrightness * 1.1));

  return {
    version: 8,
    projection: {type: "globe"},
    metadata: {
      "worldsat:theme-water": colors.water,
      "worldsat:theme-land": colors.land,
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
        id: "worldsat-themed-surface",
        type: "background",
        paint: {"background-color": surface},
      },
      {
        id: "esri-dark-base",
        type: "raster",
        source: "esri-dark-base",
        paint: {
          "raster-opacity": baseOpacity,
          "raster-saturation": -1,
          "raster-contrast": 0.18,
          "raster-brightness-min": 0,
          "raster-brightness-max": brightnessMax,
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
