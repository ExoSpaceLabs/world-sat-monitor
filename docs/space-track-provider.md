# Space-Track GP provider (incremental v1.2 development)

Space-Track is an **optional** second orbital-data provider. It uses the same
`NormalizedElementSet` and `provider_priority` mechanisms as CelesTrak, so
existing database provenance, source freshness, SGP4 execution and failover paths
are reused. No credentials or Space-Track API calls are made by the browser.

## Upstream constraints

Official documentation: https://www.space-track.org/documentation

- Use the **GP** class, not legacy TLE API classes. JSON GP/OMM records support
  the nine-digit catalog identifiers that legacy TLE text cannot represent.
- Space-Track recommends GP acquisition **once an hour** and explicitly warns
  against issuing one HTTP request per spacecraft.
- API request ceilings are **less than 30/minute and 300/hour**. This adapter
  reserves headroom with a process-local budget of 24/minute, 240/hour.
- The worker consults PostgreSQL's last-success and retry timestamps before
  building the batch; a process restart does not override an existing fresh
  provider state.
- Only one batch (up to 80 NORAD IDs by default) is requested per worker cycle.
  Remaining IDs are deferred until another cycle; deferred work is not recorded
  as a provider outage.
- All access is authenticated via POST /ajaxauth/login with a session cookie.
  The session is reused in the **single orbital-provider worker process**.
- This process-local budget is **not** a distributed limiter. Run one
  Space-Track-enabled provider-worker instance per account. External users of
  the same account must share the overall upstream budget independently.

## Enablement

By default `SPACETRACK_ENABLED=false`. Supply credentials only to the
`orbital-provider` service. The standard Compose files expose these
environment variables for opt-in local deployments:

```dotenv
SPACETRACK_ENABLED=true
SPACETRACK_IDENTITY=your-space-track-login
SPACETRACK_PASSWORD=your-space-track-password
```

Store real credentials using a deployment secret manager or protected
environment file, never in source control. Be aware Docker environment values
are visible to administrators with container-inspection access.

Optional worker configuration:

| Variable | Default | Meaning |
|---|---|---|
| `SPACETRACK_BASE_URL` | `https://www.space-track.org` | HTTPS origin |
| `SPACETRACK_TIMEOUT_SECONDS` | `15` | HTTP timeout |
| `SPACETRACK_BATCH_SIZE` | `80` | NORAD IDs per GP request, capped at 100 |
| `SPACETRACK_REFRESH_SECONDS` | `3600` | Minimum batch-cache age before refresh (minimum one hour) |

The default `provider_priority` remains `["celestrak"]`. No existing
satellite changes its data source automatically. To select Space-Track for an
existing satellite, update its provider policy through the existing satellite
API with:

```json
{"provider_priority": ["spacetrack", "celestrak"]}
```

The provider registry endpoint `GET /api/v1/providers` advertises Space-Track
as supporting *single-satellite* acquisition, but not group importing or
catalog searching. `GET /api/v1/satellites/{id}/orbital-status` exposes the
provider candidate chain and the actual source used by the current state.

## Behavior under errors

- Missing/invalid NORAD identifiers fail validation without making requests.
- Missing elements in a successful GP batch are reported as provider errors;
  the next provider (or previously stored elements) remains usable.
- Invalid credentials, invalid JSON, or a network error are not treated as
  successful refreshes. The batch scheduler pauses for five minutes on failure.
- Work queued beyond the batch/request budget is **deferred**, not counted as
  an external provider failure.
- HTTP 401/403 invalidates the session. A later batch attempts authentication
  again after cooldown.
- A successful response is cached for at least one hour. Source-age and
  propagation-age are distinct measurements.

## Limitations and follow-up

This increment provides authenticated batched current GP acquisition and
per-satellite provider-priority integration. It does **not** implement:

- Space-Track constellation/group definitions or interactive SATCAT search;
- shared multi-instance throttling, credential management UI or account quotas;
- prediction-quality evaluation against newer GP or authoritative ephemerides;
- independently validated live Space-Track login, which requires an account.

Maintain #19 open for prediction-quality work and live-auth integration checks.
Tests use deterministic fixture records and never contact Space-Track.
