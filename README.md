# WorldSat Monitor

WorldSat Monitor is a web-based satellite mission display built around an
interactive 3D Earth. The current checkpoint is intentionally frontend-only:
it renders one stationary mock spacecraft and a mocked heading vector while
the orbit-propagation and telemetry services remain offline.

## Current capabilities

- MapLibre GL globe with view-dependent tile streaming
- CARTO Dark, OpenStreetMap Standard, and Esri satellite-imagery basemaps
- Optional starfield and time-driven sun position
- Optional UTC solar terminator for daytime/nighttime differentiation
- Continuous globe rotation with a short pause after manual interaction
- Camera follow mode for the selected satellite
- Stationary `WORLDSAT-01` mock satellite and heading vector
- Drag rotation, deep zoom, camera reset, and responsive mission UI

## Map data

- Dark map: [CARTO Dark Matter](https://carto.com/basemaps/)
- Street map: [OpenStreetMap](https://www.openstreetmap.org/)
- Satellite imagery: [Esri World Imagery](https://www.esri.com/)

Only the tiles required for the visible camera position and zoom are loaded.
For a production or high-traffic deployment, the public tile endpoints should
be replaced by a contracted provider or self-hosted tile service.

## Architecture direction

The browser is the rendering client. Future services will own TLE ingestion,
catalogue storage, orbit propagation, telemetry adapters, and API/WebSocket
delivery. Those services are expected to be independently deployable through
Docker Compose; the UI should consume propagated state rather than run the
authoritative orbit model in the browser.

## Development

Run the Docker Compose project:

```bash
docker compose up --build
```

The UI is available at `http://localhost:3000`. The Compose service is named
`ui`, leaving the project ready for later backend, database, and external API
services.

For development without Docker, requirements are Node.js `>=22.13.0` and npm.

```bash
npm ci
npm run dev
```

Quality gates:

```bash
npm run lint
npm test
```

The application source is primarily in `app/page.tsx` and `app/globals.css`.
