const DEG = Math.PI / 180;

function normalizeSolarLongitude(longitude: number) {
  return (((longitude % 360) + 540) % 360) - 180;
}

export type SolarState = {
  latitude: number;
  /** Subsolar longitude in the Earth-fixed frame. */
  longitude: number;
};

export const NIGHT_SHADOW_ALPHA = 0.3;

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

export function shadowAlpha(illumination: number) {
  if (illumination >= 0) return 0;
  const terminatorBlend = Math.min(1, -illumination / 0.025);
  return NIGHT_SHADOW_ALPHA * terminatorBlend;
}
