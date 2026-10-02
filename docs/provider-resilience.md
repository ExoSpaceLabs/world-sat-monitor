# Provider resilience and orbital-source quality

WorldSat Monitor v1.1 treats external orbital providers as intermittent inputs, not runtime dependencies.

## CelesTrak request policy

CelesTrak GP requests use a bounded retry policy. Defaults are:

- request timeout: 15 seconds;
- attempts: 2;
- retry delay: 0.5 seconds with exponential delay between attempts;
- normal orbital refresh interval: 2 hours.

These values are configurable with `CELESTRAK_TIMEOUT_SECONDS`,
`CELESTRAK_REQUEST_ATTEMPTS`, `CELESTRAK_RETRY_DELAY_SECONDS`, and
`PROVIDER_REFRESH_SECONDS`.

## Catalog cache

Successful interactive catalog queries are cached in the long-running provider
service for 2 hours by default. If CelesTrak is temporarily unavailable, a cached
response may remain usable for up to 24 hours.

The cache is bounded and process-local. It reduces repeat upstream traffic and
keeps common Manager searches usable during short provider outages.

Configuration:

- `CELESTRAK_CATALOG_CACHE_SECONDS` (default 7200)
- `CELESTRAK_CATALOG_STALE_SECONDS` (default 86400)

## Persistent provider backoff

Per-satellite provider state records last attempt, last success, last error,
consecutive failures, next permitted retry, and the latest accepted element set.
Repeated failures use exponential backoff starting at 30 seconds and capped at
30 minutes by default.

Provider-defined constellation display requests use the same backoff policy,
stored on the group, so an upstream outage does not turn a displayed constellation
into a request every provider poll cycle.

Existing element sets and propagation products remain usable during provider
backoff.

Configuration:

- `PROVIDER_RETRY_BASE_SECONDS` (default 30)
- `PROVIDER_RETRY_MAX_SECONDS` (default 1800)

## Orbital-source status API

`GET /api/v1/satellites/{satellite_id}/orbital-status` exposes provider health,
retry state, element-set source/epoch/fetch time, source age, freshness, latest
completed propagation provenance, and current-state provenance.

Freshness labels are operational hints relative to the configured refresh interval:

- `fresh`: no older than two refresh intervals;
- `aging`: older than that but no older than the larger of six refresh intervals or 24 hours;
- `stale`: older than the aging threshold;
- `unknown`: no accepted element set exists.

These labels describe source age. They are not navigation-accuracy guarantees.


## Local catalog fallback

Interactive satellite discovery normally queries CelesTrak after checking the in-memory
catalog cache. If CelesTrak is unavailable and no usable cached response exists,
WorldSat Monitor searches its persistent local satellite catalog by name, NORAD ID,
COSPAR ID, and other stored identifiers.

Local fallback results are marked with `metadata.catalog_fallback = "local"`. They
can still be monitored or added to custom groups because the satellite already exists
locally. If neither CelesTrak nor the local catalog has a match, the catalog endpoint
returns HTTP 503 to distinguish provider unavailability from an application gateway
failure.


## Group orbital-quality summary

The group Details view uses `GET /api/v1/groups/{group_id}/orbital-status`.
The backend aggregates source quality in PostgreSQL and returns a constant-size
summary instead of returning one status object per group member.

The response includes element-set and current-state coverage, fresh/aging/stale/
unknown counts, provider-health counts, provider distribution, epoch range, provider
success range, and a bounded list of the ten members requiring the most attention.
Backoff/degraded members rank ahead of stale, unknown, and aging source data.

This endpoint intentionally does not read `position_samples`. Constellation-scale
status comes from group membership, orbital-element metadata, provider fetch state,
and the one-row-per-satellite current-state table. The constellation benchmark also
measures this path at 100, 1,000, and 5,000 members.


## Provider priority and failover

Each satellite now carries an ordered `provider_priority` list. The legacy
`provider_preference` field remains available during the v1.1 transition and is
kept synchronized with the first priority entry.

Examples:

```json
{"provider_priority": ["celestrak"]}
```

and, once another provider is configured:

```json
{"provider_priority": ["spacetrack", "celestrak"]}
```

The orbital-provider worker evaluates the list in order. A provider in backoff, a
disabled provider, an unsupported provider, or a provider request failure does not
prevent the worker from trying the next configured source. Provider health and retry
state remain independent for each provider.

If no live provider succeeds, the worker can continue scheduling propagation from
the best stored element set selected according to the same priority order. This is a
degraded operational fallback, not a successful provider refresh.

The synthetic WorldSat object is always forced to the `mock` provider regardless of
stored external-provider fields. This prevents a test identifier from ever being sent
to an external orbital-data service.

Provider construction is centralized in `provider_registry.py`. Adding a new orbital
provider therefore requires registering its factory and implementing the
`OrbitalDataProvider` contract rather than adding provider-name branches throughout
the worker.

`GET /api/v1/providers` exposes the registered provider names, enabled state, provider
kind, and single/group/catalog capabilities. Future UI for provider-priority editing
can therefore discover backend capabilities instead of maintaining a second provider
registry in the frontend.


### Active-source provenance

The single-object orbital-status endpoint reports the element set referenced by
`satellite_current_state` when one exists. This is deliberate: after a provider
failover, operator-facing provenance must describe the source actually driving the
current propagated state rather than an older element set belonging to a
higher-priority provider.

Provider-managed group display refresh is also provider-neutral. The group source is
resolved through the provider registry and must advertise a callable group-fetch
operation; the display worker no longer contains a CelesTrak-specific refresh branch.


## Provider selection policy

Each satellite now has an ordered `provider_priority` policy. The first entry is
the preferred source; later entries are fallbacks. Provider workers evaluate the
ordered list independently, including per-provider retry/backoff state, and retain
stored orbital elements as a final degraded fallback.

`provider_preference` remains in the API and database only as a compatibility
alias for the first priority entry. Runtime provider selection must use
`provider_priority` / `provider_priority_for()`; new provider integrations must
not add special-case reads of the legacy alias.

The provider registry exposes capabilities through `GET /api/v1/providers`.
Adding a provider therefore consists of registering its implementation/capabilities
and making it available to the ordered policy, rather than adding provider-specific
branching throughout the worker.

The single-satellite orbital-status response reports the full candidate chain with
health, retry state, and which source is currently active. This makes failover
observable instead of merely reporting the source that happened to win.
