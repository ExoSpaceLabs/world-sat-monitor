# Constellation-scale performance policy

WorldSat Monitor v1 treats **current state** and **trajectory history/prediction** as different workloads. This is the central scaling rule of the application.

A constellation view must not scan the detailed trajectory table simply to answer where its members are now.

## Performance goals

The v1 performance design targets:

- inexpensive current-state access for hundreds to several thousand satellites;
- one detailed trajectory workload for the selected satellite;
- bounded browser rendering work for large groups;
- controlled trajectory-storage growth;
- deterministic CI benchmarks rather than relying on subjective map smoothness.

## Backend benchmark

Run:

```bash
DATABASE_URL=postgresql://worldsat:worldsat@localhost:5432/worldsat \
PYTHONPATH=backend \
python backend/tools/benchmark_constellation.py --sizes 100 1000 5000 --enforce
```

The benchmark uses PostgreSQL, seeds deterministic synthetic current/trajectory state, exercises current-state and selected-track queries, verifies query behavior, and checks trajectory retention.

Conservative CI p95 limits are:

| Workload | CI p95 target |
| --- | ---: |
| Group current state, 100 objects | <= 100 ms |
| Group current state, 1,000 objects | <= 250 ms |
| Group current state, 5,000 objects | <= 800 ms |
| Arbitrary 5,000-object current-state selection | <= 1,000 ms |
| One selected track, common UI window | <= 200 ms |

The limits are CI guardrails rather than promises for every host/storage configuration.

## Frontend group benchmark

Run:

```bash
cd frontend
npm run benchmark:groups
```

The frontend benchmark measures the JavaScript preparation required to convert large current-position arrays into the render-point representation consumed by the group canvas renderer.

CI includes workloads through 10,000 objects and uses a conservative target of:

| Workload | CI target |
| --- | ---: |
| 10,000-object group render preparation | <= 100 ms p95 |

This is not a browser FPS benchmark. Actual frame rate additionally depends on:

- GPU/driver;
- viewport size and device pixel ratio;
- map zoom/pitch;
- basemap;
- whether names/direction vectors are enabled;
- number of visible, non-occluded objects.

## Browser rendering strategy

Group mode does **not** create one DOM/MapLibre marker per satellite.

`GroupSatelliteLayer` uses a single canvas overlay:

1. current positions are transformed into compact render points;
2. each member is projected through MapLibre/globe helpers;
3. Earth-occluded/off-screen points are skipped;
4. visible markers are drawn into the canvas;
5. optional direction vectors/names are drawn in the same pass;
6. projected points are retained for hover/click hit testing.

This keeps DOM complexity essentially constant as group size grows.

A selected satellite remains a separate detailed renderer using its own MapLibre marker and custom WebGL orbit layer.

### Interactive profiling

For manual browser profiling:

1. use a production frontend build;
2. display a multi-thousand-member constellation;
3. test with names/direction vectors both disabled and enabled;
4. rotate/zoom the globe for at least ten seconds;
5. record browser Performance/GPU traces;
6. verify there is no marker-DOM explosion or repeated allocation loop dominating every frame.

## Current-state query strategy

### Stored groups

`GET /api/v1/groups/{id}/positions` performs one joined current-state query over the selected collection.

The relevant data path is:

```text
satellite_group_members
        + satellites
        + satellite_current_state
        + external identifier row
```

It is capped at 10,000 returned positions.

### Arbitrary selections

`POST /api/v1/positions/current` accepts batches of local satellite IDs and/or NORAD identifiers, also capped at 10,000 requested objects.

### Critical invariant

Neither current-state path scans `position_samples`.

`satellite_current_state` is the optimized one-row-per-satellite answer to:

> Where is everything now?

The detailed trajectory table answers a different question and is kept out of the large-group hot path.

## Gateway compression

The nginx gateway enables compression for JSON responses where appropriate. Multi-thousand-object current-state payloads are repetitive and compress well; avoiding needless transfer volume is cheaper than pretending network serialization is someone else's performance problem.

## Trajectory storage policy

A uniform 60-second grid over the default 48-hour history plus 14-day prediction horizon would create:

```text
(48 h + 14 d) * 3600 / 60 + 1 = 23,041 samples/run/satellite
```

That means roughly:

- 23.0 million rows for one run generation of 1,000 satellites;
- 115.2 million rows for one run generation of 5,000 satellites.

Storing that uniformly and then heroically tuning PostgreSQL around it would preserve an avoidable problem.

v1 therefore uses tiered propagation sampling.

## Tiered sampling

Default `tiered-v1` policy:

| Region relative to generation | Default cadence |
| --- | ---: |
| History through +24 h | 60 s base cadence |
| +24 h through +72 h | 300 s |
| Beyond +72 h | 900 s |

For the default 48-hour history / 14-day horizon, this produces approximately **5,953 samples/run/satellite**, roughly a **74% row reduction** compared with the uniform 60-second layout.

The exact sampling policy is persisted in `propagation_runs.sampling_policy`.

Configurable parameters:

```text
PROPAGATION_NEAR_HORIZON_HOURS
PROPAGATION_MID_HORIZON_HOURS
PROPAGATION_MID_STEP_SECONDS
PROPAGATION_FAR_STEP_SECONDS
```

## Interpolation and track decimation

Position requests interpolate between bracketing samples in ECEF space.

Track requests decimate by time bucket according to requested resolution and API point limits. They do not assume stored samples have a uniform cadence.

This means the storage optimization does not leak into the UI as a requirement to understand tier boundaries.

## Index strategy

Important access paths include:

- primary key `(run_id, sample_time)` for bracketing/track reads;
- `ix_position_samples_satellite_time (satellite_id, sample_time)` for satellite/time maintenance;
- partial completed-run lookup index for newest covering runs;
- primary key `satellite_current_state(satellite_id)` for batch current-state joins;
- primary key `satellite_group_members(group_id, satellite_id)` for group membership fan-in.

A large covering index duplicating all trajectory coordinates is deliberately avoided because write/storage cost would be paid on the largest table to accelerate a run-local read path that already has a suitable key.

## Retention

The propagator periodically removes trajectory samples from superseded completed runs older than the configured retention window.

It does **not** delete the propagation-run provenance row merely because detailed samples are removed.

For active satellites, protected references include:

1. the newest completed run;
2. the run referenced by `satellite_current_state`.

Inactive satellites do not pin detailed trajectory samples indefinitely. Reactivation causes the normal provider/propagation lifecycle to produce fresh state.

Defaults:

```text
PROPAGATION_SAMPLE_RETENTION_HOURS=24
PROPAGATION_CLEANUP_INTERVAL_SECONDS=300
PROPAGATION_CLEANUP_BATCH_SIZE=250000
```

Cleanup is batched to avoid one enormous transaction and unnecessary lock/vacuum pressure.

## Partitioning decision

`position_samples` is not partitioned in v1.

Current reasons:

- primary reads are run-local;
- group/current-state reads bypass the table;
- tiered sampling removes most of the previously expected far-horizon rows;
- superseded samples are deleted in bounded batches;
- partitioning would add migration/constraint complexity before measurements justify it.

Re-evaluate native PostgreSQL partitioning when real deployment measurements show conditions such as:

- retained `position_samples` consistently around or above 100 million rows;
- cleanup batches taking multiple seconds or causing unacceptable vacuum pressure;
- selected-run track p95 exceeding the documented target despite healthy indexes/cache;
- a requirement to retain long historical trajectory windows.

If that threshold is reached, benchmark run-generation/time partitioning against time-only partitioning. The partition key must preserve efficient selected-run reads; choosing calendar partitions merely because the table contains timestamps would be decorative architecture.

## CI enforcement

Performance checks run in the normal CI pipeline on both `develop` and `main`.

The goal is regression detection:

- a group query accidentally scanning trajectory history should fail visibly;
- a change that turns marker preparation into an unexpectedly expensive operation should be caught;
- storage/retention policy should remain testable and reproducible.

These tests complement, rather than replace, browser profiling on realistic hardware and network/provider conditions.
