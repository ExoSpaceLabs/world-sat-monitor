# Browser and visual UI validation

Tracking: [#39](https://github.com/ExoSpaceLabs/world-sat-monitor/issues/39).

## Principle

A passing React/unit test or a reported WebGL draw call does **not** prove
the globe and its shadows are visible. Browser qualification must test both
observable behavior and final screen output from the actual Compose build.

### Four validation layers

| Layer | Checks | Trigger |
| --- | --- | --- |
| Browser functions | Buttons, panels, settings, manager CRUD, persisted state | Every pull request and develop/main push |
| Browser scene rendering | Actual WebGL2 canvas and screenshot differences caused by basemap or shadow controls | Every pull request and develop/main push |
| Approved visual snapshots | Layout, orbit tracks, satellite symbols, group labels, day/night terminator, responsive panels | Extend PR gate after stable clock/camera fixtures and reviewed baselines |
| Live infrastructure | Real raster/vector tile providers, real end-to-end application deployment, multiple browsers/GPUs, performance | Nightly/manual and release smoke |

The first two layers are implemented initially as a new blocking `ui-browser`
job in `CI`. The last two layers are required work before claiming complete UI
qualification.

## Reproducible environment

- Use production-built `docker compose up --build -d`, not only component mocks.
- Use Chromium Playwright with deterministic 1280 × 800 viewport, device scale
  1 and software WebGL for the first reference platform.
- Use local, predictable PNG raster tiles returned by Playwright routing instead
  of depending on OSM/Esri availability for pull-request tests.
- Keep CelesTrak and Space-Track disabled; use `WORLDSAT-01` to exercise the
  real backend, PostgreSQL and SGP4 jobs.
- Let actual browser network calls reach the WorldSat API; the UI-test tile
  fixtures intercept *only* third-party imagery requests.
- The shadow test fixes browser UTC to midnight with an Africa-facing view,
  measures image noise between two 0%-opacity captures, then requires the
  0%-versus-100% change to exceed that baseline by a meaningful margin.
- Require reported shadow shader READY and a positive triangle count, **plus**
  a nontrivial change in final rendered pixels. Status telemetry alone is
  insufficient evidence.
- Tests are sequential in one isolated Compose database. Each test uses an
  independent browser context and resets the persisted application settings
  through the backend before opening the page. Object CRUD tests clean up
  their own records.

The first comparison thresholds are preliminary and must be calibrated
against observed test artifacts. They are not a pixel-perfect golden image.
Software WebGL is not a substitute for at least one real GPU/driver campaign.

## Run locally

From repository root, with Python 3.13, Docker and Compose v2:

```bash
docker compose up --build -d
python -m pip install -r ui-tests/requirements.txt
python -m playwright install --with-deps chromium
python -m unittest discover -s ui-tests -p 'test_*.py' -v
docker compose down -v
```

**Caution:** `docker compose down -v` destroys the Compose database/settings
volumes. Only run this command against a disposable test stack.

CI provisions a clean stack and sets `CELESTRAK_ENABLED=false` and
`SPACETRACK_ENABLED=false`. Local runs must explicitly disable live providers
if the environment isn't already configured for fixtures.

The browser suite saves a screenshot and Playwright trace for each case under
`ui-artifacts/`; CI uploads that directory even if tests fail. For
investigation, use the trace viewer:
`python -m playwright show-trace ui-artifacts/<test>-trace.zip`.

## Run the same browser suite against public ChatGPT Sites

For the hosted Sites demo, no local Docker or PostgreSQL is needed. Each
Playwright browser context starts with a **fresh Sites D1 guest cookie** and
isolated settings. The test runner does **not** call the Compose-only
`/api/v1/settings/reset` endpoint when `WORLDSAT_UI_TARGET=sites`.

```bash
python -m pip install -r ui-tests/requirements.txt
python -m playwright install chromium
WORLDSAT_UI_TARGET=sites \
WORLDSAT_UI_BASE_URL="https://<your-actual-site-hostname>" \
python -m unittest discover -s ui-tests -p 'test_*.py' -v
```

The same test scenarios and screenshots/traces are used for Compose and
Sites. No duplicate test suite is maintained. Hosted runs use real Sites
D1, Worker APIs and WebGL, while deterministic tile fixtures replace only
external raster requests. A hosted run consumes guest/demo storage and
provider budget; do not schedule it at high frequency or run against a
production account's persistent data. The hosted test is **not** part of
blocking GitHub CI until a safe external test URL and release policy are
configured.

## Executed first-wave contracts

- UI-001/002: browser boots, API ONLINE and MAP READY, a real WebGL2 globe
  drawing surface exists, and clicking MAP SETTINGS opens/closes the panel.
- UI-003: clicking STREET changes aria state, performs OSM tile requests, and
  causes a measurable change in the rendered globe pixels.
- UI-004/005: enabling scene debug reports a ready, nonempty shadow mesh;
  moving shadow opacity from 0 to 100 causes a measurable change in the
  captured globe rather than merely updating a label. Toggling environment
  OFF updates the visible footer.
- UI-007: MANAGER creates an inactive object through actual UI controls,
  object survives a reload, and deletion removes it.
- UI-006: a real wheel zoom changes the reported MapLibre camera zoom; RESET
  VIEW returns the camera to the documented initial zoom.
- UI-008: MANAGER creates a group, adds the seeded WORLDSAT-01 member, then
  GROUP mode displays the collection and obtains a ready group position.
  The test cleans up the group without deleting the shared fixture satellite.
- UI-009 (behavioral): disabling DRAW ORBIT PATH persists to the backend,
  survives a page reload, and can be re-enabled; this does **not** yet prove
  the orbit pixels changed or geometry is physically correct.

### Still required

1. Deterministic full-scene clock/solar-position/camera injection for golden
   screenshot baselines. Document a test-only hook with an explicit build/test
   boundary rather than introducing production backdoors.
2. Approved reference screenshots for single, group, imagery styles, direction
   vectors, orbit ground/altitude placement, illumination, About, settings,
   manager and responsive layouts. Baseline updates must be reviewed.
3. Independent night/day hemispheres and a terminator-location physics check
   using known UTC/subsolar coordinates; positive pixel difference is a
   rendering smoke test, **not** sufficient to validate spatial correctness.
4. Camera drag assertions, orbit placement pixel validation, catalog fallback
   error states, source-quality Details, persistence and network failure cases.
5. Mobile viewport and GPU/OS/browser matrix; release smoke tests against
   published pinned images, not just locally built containers.
6. Console error and failed network capture beyond uncaught JS exceptions,
   plus explicit WebGL context loss and shader regression tests.

## Release policy

This browser job is part of the existing `CI` workflow, **not a separate
workflow**. A failing browser run therefore prevents CI from concluding
success on `main`, blocking the current CI-gated publisher.

Only reviewed production code changes should update accepted screenshot
baselines. Never have CI regenerate expected screenshots automatically.
