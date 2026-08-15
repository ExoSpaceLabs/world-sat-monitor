# WorldSat Monitor architecture

WorldSat Monitor is split into independently deployable frontend, backend, database, and gateway services. The backend owns orbital data access and interpolation; the frontend owns visualization and user interaction.

## Runtime topology

```mermaid
flowchart LR
    U[Browser] --> G[Gateway / nginx]
    G --> F[Frontend]
    G --> B[Backend API]
    B --> DB[(PostgreSQL)]
    B --> CFG[(Mounted settings.json)]
```

The browser talks to one same-origin gateway. The frontend never needs Docker-internal service names and the backend remains the API boundary for satellite state and persistent application settings.

## Current mock-orbit flow

```mermaid
flowchart TD
    SEED[Database initialization] --> MOCK[Generate WORLDSAT-01 mock orbit]
    MOCK --> ECEF[10 s ECEF samples]
    ECEF --> DB[(position_samples)]
    DB --> API[Backend API]
    API --> POS[Interpolated position endpoint]
    API --> TRACK[History / prediction track endpoint]
    POS --> UI[Frontend]
    TRACK --> UI
```

The mock orbit exists so API and rendering work can proceed independently of the future TLE acquisition and SGP4 services.

## Position interpolation

```mermaid
flowchart LR
    T[Requested UTC] --> Q[Query surrounding samples]
    Q --> A[t0 ECEF state]
    Q --> B[t1 ECEF state]
    A --> I[Linear Cartesian interpolation]
    B --> I
    I --> GEO[lat / lon / altitude]
    GEO --> R[API response]
```

Interpolation is performed in Cartesian ECEF coordinates rather than directly interpolating longitude. This avoids discontinuities at the ±180 degree meridian.

## Orbit display rendering

Orbit settings are global. Every tracked satellite shares path history/prediction lengths, refresh cadence, interpolation cadence, direction-vector visibility, and track-placement mode.

```mermaid
flowchart TD
    API[Backend track samples] --> SEG[Great-circle rendering subdivision]
    SEG --> SPLIT[Dateline split]
    SPLIT --> BUF[World Mercator x/y + altitude representations]
    BUF --> WEBGL[MapLibre custom WebGL overlay]
    SETTINGS[Global Orbit Settings] --> WEBGL
    WEBGL --> MODE{Track placement}
    MODE -->|GROUND| ZERO[Elevation = 0]
    MODE -->|ORBIT| ALT[Propagated altitude]
    ZERO --> PROJ[MapLibre projectTileWithElevation]
    ALT --> PROJ
    PROJ --> VIEW[History / prediction / direction vector]
```

The orbit renderer is an elevated **2D custom overlay**, not a depth-sharing 3D custom layer. MapLibre still performs the globe-aware geographic projection, elevation, globe-to-Mercator transition, and horizon clipping. The overlay classification keeps history/prediction readable above the basemap instead of participating in a depth pipeline that the application would then disable anyway.

Each vertex carries altitude both in metres and as conformal Mercator z. The globe shader consumes metres; the Mercator shader consumes conformal z. This keeps the same orbit visible through MapLibre's projection transition instead of relying on one unit system for two incompatible shader variants.

The frontend never derives authoritative orbital states during rendering. Great-circle subdivision only adds display vertices between backend samples so long line segments follow the globe smoothly.

## Persistent settings

```mermaid
flowchart LR
    UI[Map / Orbit Settings UI] -->|PUT /api/v1/settings| API[Backend]
    API --> VALIDATE[Pydantic validation]
    VALIDATE --> TMP[settings.json.tmp]
    TMP --> SYNC[fsync]
    SYNC --> RENAME[atomic replace]
    RENAME --> JSON[(settings.json volume)]
    JSON -->|startup GET| UI
```

Persistent configuration contains map and global orbit-display settings. Runtime interaction state such as the currently selected satellite or active camera drag is deliberately not stored in the settings document.

Reset operations write default values back to the same mounted JSON configuration rather than keeping a second hidden source of truth.

## Planned TLE and propagation pipeline

```mermaid
flowchart LR
    CAT[(Managed satellites)] --> FETCH[TLE fetcher]
    FETCH --> TLE[(tle_sets)]
    FETCH --> JOB[(propagation_jobs)]
    JOB --> PROP[SGP4 propagator]
    TLE --> PROP
    PROP --> RUN[(propagation_runs)]
    PROP --> SAMPLE[(position_samples)]
    SAMPLE --> API[Backend API]
    TLE --> EVAL[Prediction evaluator]
    RUN --> EVAL
    EVAL --> ERR[(prediction error observations / aggregates)]
```

The backend API is a read/query service. TLE collection and propagation are separate workers so provider latency, scheduled updates, or long-running propagation cannot block browser requests.

PostgreSQL can initially act as the propagation job queue using row locking such as `FOR UPDATE SKIP LOCKED`. A dedicated broker is unnecessary until throughput or delivery guarantees demonstrate that one is actually required.

## Prediction quality model

A newly published TLE is not ground truth. Prediction quality is therefore described as disagreement against a later reference state, initially a newer TLE and eventually a higher-quality ephemeris if one becomes available.

```mermaid
flowchart TD
    OLD[Older TLE at T0] --> PROP[Propagate to later epoch]
    NEW[Later reference TLE / ephemeris] --> CMP[Compare states]
    PROP --> CMP
    CMP --> OBS[Raw error observation]
    OBS --> DAY[Bucket by forecast horizon]
    DAY --> AGG[Mean / RMS / P95 / Max / sample count]
    AGG --> UI[Prediction quality graph]
```

This allows users to see how uncertainty tends to grow with forecast horizon without presenting a TLE-derived comparison as absolute navigation truth.

## Data ownership

```mermaid
flowchart TB
    FETCHER[TLE fetcher] -->|writes| TLE[(tle_sets)]
    PROPAGATOR[Propagator] -->|writes| RUN[(propagation_runs)]
    PROPAGATOR -->|writes| SAMPLE[(position_samples)]
    EVALUATOR[Error evaluator] -->|writes| ERR[(prediction quality)]
    BACKEND[Backend API] -->|reads| TLE
    BACKEND -->|reads| RUN
    BACKEND -->|reads| SAMPLE
    BACKEND -->|reads| ERR
    BACKEND -->|owns| SETTINGS[(settings.json)]
    FRONTEND[Frontend] -->|HTTP only| BACKEND
```

Service ownership should remain narrow. In particular, the frontend does not propagate TLEs and the backend request process does not become the scheduler/propagator by convenience.