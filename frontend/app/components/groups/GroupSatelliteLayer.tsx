"use client";

import {useEffect, useRef} from "react";
import type {GeoJSONSource, MapMouseEvent} from "maplibre-gl";
import type {FeatureCollection, Point} from "geojson";
import type {GroupPosition} from "../../domain/satellite";
import type {MapSession} from "../../domain/types";
import {buildGroupFeatureCollection, type GroupMarkerProperties} from "./group-features";

const SOURCE_ID = "worldsat-group-satellites";
const LAYER_ID = "worldsat-group-satellite-markers";
const EMPTY_COLLECTION: FeatureCollection<Point, GroupMarkerProperties> = {type: "FeatureCollection", features: []};

type GroupSatelliteLayerProps = {mapSession: MapSession | null; positions: GroupPosition[]; selectedNoradId: string; onSelect: (noradId: string) => void};

export function GroupSatelliteLayer({mapSession, positions, selectedNoradId, onSelect}: GroupSatelliteLayerProps) {
  const dataRef = useRef<FeatureCollection<Point, GroupMarkerProperties>>(EMPTY_COLLECTION);
  useEffect(() => {
    dataRef.current = buildGroupFeatureCollection(positions, selectedNoradId);
    if (!mapSession) return;
    (mapSession.map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(dataRef.current);
  }, [mapSession, positions, selectedNoradId]);
  useEffect(() => {
    if (!mapSession) return;
    const {map} = mapSession;
    const install = () => {
      if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, {type: "geojson", data: dataRef.current});
      if (!map.getLayer(LAYER_ID)) map.addLayer({
        id: LAYER_ID, type: "circle", source: SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, ["case", ["==", ["get", "active"], true], 2.2, 1.7], 3, ["case", ["==", ["get", "active"], true], 3.2, 2.4], 6, ["case", ["==", ["get", "active"], true], 4.5, 3.5]],
          "circle-color": ["case", ["==", ["get", "active"], true], "#62f6c8", "#66828b"],
          "circle-opacity": ["case", ["==", ["get", "active"], true], 0.9, 0.4],
          "circle-stroke-color": "#d4f2f7",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 0, 3, 0.5, 6, 1],
          "circle-stroke-opacity": 0.7,
        },
      });
      (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(dataRef.current);
    };
    install();
    const onStyleData = () => install();
    const onClick = (event: MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, {layers: [LAYER_ID]})[0];
      const noradId = feature?.properties?.norad_id;
      if (typeof noradId === "string" && noradId) onSelect(noradId);
    };
    const onEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { map.getCanvas().style.cursor = ""; };
    map.on("styledata", onStyleData); map.on("click", LAYER_ID, onClick); map.on("mouseenter", LAYER_ID, onEnter); map.on("mouseleave", LAYER_ID, onLeave);
    return () => {
      map.off("styledata", onStyleData); map.off("click", LAYER_ID, onClick); map.off("mouseenter", LAYER_ID, onEnter); map.off("mouseleave", LAYER_ID, onLeave);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [mapSession, onSelect]);
  return null;
}
