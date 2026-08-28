import type {FeatureCollection, Point} from "geojson";
import type {GroupPosition} from "../../domain/satellite";

export type GroupMarkerProperties = {satellite_id: number; norad_id: string; name: string; active: boolean};

export function buildGroupFeatureCollection(positions: GroupPosition[], selectedNoradId: string): FeatureCollection<Point, GroupMarkerProperties> {
  return {
    type: "FeatureCollection",
    features: positions.flatMap((item) => {
      if (!item.position || !item.satellite.norad_id || item.satellite.norad_id === selectedNoradId) return [];
      return [{
        type: "Feature" as const,
        geometry: {type: "Point" as const, coordinates: [item.position.lon_deg, item.position.lat_deg]},
        properties: {satellite_id: item.satellite.id, norad_id: item.satellite.norad_id, name: item.satellite.name, active: item.satellite.active},
      }];
    }),
  };
}
