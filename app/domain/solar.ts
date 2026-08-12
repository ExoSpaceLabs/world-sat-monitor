const DEG = Math.PI / 180;

function normalizeSolarLongitude(longitude: number) {
  return (((longitude % 360) + 540) % 360) - 180;
}

export type SolarState = {
  latitude: number;
  /** Subsolar longitude in the Earth-fixed frame. */
  longitude: number;
};

export type NightShadowCell = {
  west: number;
  south: number;
  east: number;
  north: number;
  opacity: number;
};

export function getSolarState(date: Date): SolarState {
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5;
  const daysSinceJ2000 = julianDay - 2_451_545;
  const meanLongitude = (280.46 + 0.9856474 * daysSinceJ2000) * DEG;
  const meanAnomaly = (357.528 + 0.9856003 * daysSinceJ2000) * DEG;
  const eclipticLongitude = meanLongitude + 1.915 * DEG * Math.sin(meanAnomaly) + 0.02 * DEG * Math.sin(2 * meanAnomaly);
  const obliquity = (23.439 - 0.0000004 * daysSinceJ2000) * DEG;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const centuries = daysSinceJ2000 / 36_525;
  const siderealDegrees = 280.46061837 + 360.98564736629 * daysSinceJ2000 + 0.000387933 * centuries * centuries;

  return {
    latitude: declination / DEG,
    longitude: normalizeSolarLongitude(rightAscension / DEG - siderealDegrees),
  };
}

export function inertialSolarLongitude(sun: SolarState, earthRotationDegrees: number) {
  return normalizeSolarLongitude(sun.longitude + earthRotationDegrees);
}

export function solarElevation(latitude: number, longitude: number, sun: SolarState) {
  const lat = latitude * DEG;
  const sunLat = sun.latitude * DEG;
  const deltaLon = (longitude - sun.longitude) * DEG;
  return Math.asin(
    Math.sin(lat) * Math.sin(sunLat) + Math.cos(lat) * Math.cos(sunLat) * Math.cos(deltaLon),
  ) / DEG;
}

export function nightShadowOpacity(elevation: number) {
  if (elevation >= 2) return 0;
  const transition = Math.min(1, Math.max(0, (2 - elevation) / 20));
  const eased = transition * transition * (3 - 2 * transition);
  return 0.2 + eased * 0.64;
}

/**
 * Builds a globe-safe shadow skin from small Earth-fixed cells. Unlike a
 * pole-to-pole canvas quad, these cells do not collapse at the poles or the
 * anti-meridian when MapLibre projects them onto a globe.
 */
export function createNightShadowCells(sun: SolarState, stepDegrees = 4): NightShadowCell[] {
  const cells: NightShadowCell[] = [];
  for (let south = -88; south < 88; south += stepDegrees) {
    const north = Math.min(88, south + stepDegrees);
    const latitude = (south + north) / 2;
    for (let west = -180; west < 180; west += stepDegrees) {
      const east = Math.min(180, west + stepDegrees);
      const longitude = (west + east) / 2;
      const opacity = nightShadowOpacity(solarElevation(latitude, longitude, sun));
      if (opacity > 0) cells.push({west, south, east, north, opacity});
    }
  }
  return cells;
}
