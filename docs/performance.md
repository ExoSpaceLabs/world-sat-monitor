# Constellation-scale performance policy

WorldSat Monitor treats **current state** and **trajectory history/prediction** as different workloads. Current constellation rendering must never scan the trajectory table. Detailed trajectories stay selected-object work.

## Reproducible benchmarks

Backend benchmark:

```bash
DATABASE_URL=postgresql://worldsat:worldsat@localhost:5432/worldsat \
PYTHONPATH=backend \
python backend/tools/benchmark_constellation.py --sizes 100 1000 5000 --enforce
```

The benchmark initializes an empty PostgreSQL schema, seeds deterministic synthetic constellation state, measures repeated queries, verifies the query plan does not touch `position_samples`, exercises one selected-satellite track query, and verifies retention removes only superseded trajectory rows. All benchmark data is rolled back.

Frontend marker-preparation benchmark:

```bash
cd frontend
npm run benchmark:groups
```

This measures the JavaScript work required to convert 100, 1,000, 5,000 and 10,000 current positions into the single GeoJSON source consumed by MapLibre's WebGL circle layer. It is intentionally not presented as a browser FPS benchmark. Browser frame rate also depends on GPU, window size, basemap and driver.

CI runs both benchmarks on every push/PR. Conservative CI p95 limits are:

| Workload | CI p95 target |
| --- | ---: |
| Group current state, 100 objects | <= 100 ms |
| Group current state, 1,000 objects | <= 250 ms |
| Group current state, 5,000 objects | <= 800 ms |
| Arbitrary 5,000-object current-state selection | <= 1,000 ms |
| One selected track, common UI window | <= 200 ms |
| 10,000-object GeoJSON preparation | <= 100 ms |

On a local Node 22.13 run used while implementing #18, 10,000-object GeoJSON preparation was about 1 ms median / 4 ms p95. The serialized GeoJSON was about 1.6 MB before gateway gzip. Backend timings are environment-dependent and are printed by the dedicated CI job rather than hard-coded into this document.

For interactive browser profiling, use a production build, show a 5,000+ member group, keep detailed track rendering enabled only for one selected satellite, and record a 10-second Performance trace while rotating/zooming the globe. The target is no pathological long-task loop from marker DOM creation; group markers are one WebGL GeoJSON circle layer, not thousands of DOM nodes. A selected satellite remains a separate detailed layer and is never hidden by group LOD.

## Current-state query strategy

`GET /api/v1/groups/{id}/positions` uses one joined query over:

- `satellite_group_members`
- `satellites`
- `satellite_current_state`
- the NORAD identifier row

It defaults to active members with a current state and is capped at 10,000 results. Missing/inactive members remain available through the membership endpoint without bloating the rendering response.

`POST /api/v1/positions/current` accepts up to 10,000 local satellite IDs and/or NORAD IDs and performs one current-state query. It exists for arbitrary selections that are not naturally represented by one stored group.

Neither current-state path touches `position_samples`. `satellite_current_state` is the authoritative optimized answer to “where is everything now?”.

The gateway enables gzip for JSON responses because several-thousand-object current-state payloads compress well and otherwise spend more time crossing the browser boundary than being queried.

## Trajectory storage policy

A uniform 60-second grid over the default 48-hour history plus 14-day prediction horizon creates:

```text
(48 h + 14 d) * 3600 / 60 + 1 = 23,041 samples/run/satellite
```

That is 23.0 million rows for one generation of 1,000 monitored satellites and 115.2 million rows for 5,000. Keeping that layout and then “optimizing PostgreSQL” would be an impressively elaborate way to preserve an avoidable problem.

Propagation therefore stores a tiered `tiered-v1` cadence by default:

| Region relative to generation | Default cadence |
| --- | ---: |
| History through +24 h | 60 s base cadence |
| +24 h through +72 h | 300 s |
| Beyond +72 h | 900 s |

For the default 48 h / 14 d window this produces about **5,953 samples/run/satellite**, roughly a **74% row reduction**, while preserving full cadence for the UI's common history and near-prediction windows. The exact policy is persisted in `propagation_runs.sampling_policy`.

Position queries already interpolate between bracketing samples. Track queries now decimate by time bucket rather than assuming every stored point has uniform spacing, so the tiered storage policy does not leak into the UI API contract.

The tier parameters are configurable with:

- `PROPAGATION_NEAR_HORIZON_HOURS`
- `PROPAGATION_MID_HORIZON_HOURS`
- `PROPAGATION_MID_STEP_SECONDS`
- `PROPAGATION_FAR_STEP_SECONDS`

## Index strategy

The primary trajectory access patterns are covered by:

- primary key `(run_id, sample_time)` for bracketing/track reads within a selected propagation run;
- `ix_position_samples_satellite_time (satellite_id, sample_time)` for satellite/time maintenance and diagnostics;
- `ix_propagation_runs_completed_satellite_generated`, a partial completed-run index used to find the newest run covering a request;
- primary key `satellite_current_state(satellite_id)` for batch current-state joins;
- primary key `satellite_group_members(group_id, satellite_id)` for group fan-in.

A larger covering index on every trajectory coordinate was deliberately not added. Duplicating several floating-point columns into another index would increase the dominant storage cost to accelerate a query that already reads only one selected run.

## Retention

The propagator periodically removes `position_samples` belonging to completed runs older than the configured superseded-run retention window. It does **not** delete `propagation_runs` or `prediction_error_daily`, so run provenance and quality metrics remain available.

For active satellites, two run references are protected:

1. the newest completed propagation run;
2. the run referenced by `satellite_current_state`.

Inactive satellites do not pin trajectory samples indefinitely. On reactivation the normal provider/propagation lifecycle produces a fresh current run.

Defaults:

- `PROPAGATION_SAMPLE_RETENTION_HOURS=24`
- `PROPAGATION_CLEANUP_INTERVAL_SECONDS=300`
- `PROPAGATION_CLEANUP_BATCH_SIZE=250000`

Cleanup is batched to avoid one enormous delete transaction.

## Partitioning decision

`position_samples` is **not partitioned in #18**. The main read path is run-oriented, group/current-state reads bypass the table entirely, tiered sampling removes roughly three quarters of the previously planned rows, and superseded samples are deleted in bounded batches. Time partitioning would add migration/constraint complexity without helping the primary `(run_id, sample_time)` read.

Re-evaluate native PostgreSQL partitioning when production measurements show one of these conditions:

- retained `position_samples` consistently exceeds roughly 100 million rows;
- retention batches take multiple seconds or cause unacceptable vacuum pressure;
- selected-run track p95 exceeds the documented target despite healthy cache/index plans;
- storage retention must span long historical periods that are no longer represented by a small number of active runs.

If that threshold is reached, benchmark **run-generation/time partitioning versus time-only partitioning** before migration. The partition key must preserve efficient run-local reads; partitioning by calendar time merely because the table contains timestamps would be decorative architecture.
