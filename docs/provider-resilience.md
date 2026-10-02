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
