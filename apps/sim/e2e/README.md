# Sim browser E2E

This directory contains the reusable full-stack Playwright harness. It runs the
production Next.js app, realtime, deterministic external fakes, and a migrated
per-run pgvector database.

## One-time setup

0. Install Node 22 and Bun. Playwright workers require Node 22; set
   `E2E_NODE_BINARY` to an alternate Node 22 executable when `node` on `PATH`
   points elsewhere.

1. Map the hosted E2E origin to loopback:

   ```bash
   echo "127.0.0.1 e2e.sim.ai" | sudo tee -a /etc/hosts
   ```

   The runner refuses to start unless every resolved address is loopback and an
   IPv4 `127.0.0.1` result is present. Chromium and Node are configured to prefer
   that IPv4 mapping, so CI environments that also synthesize `::1` remain safe.

2. Start a local pgvector/Postgres admin instance:

   ```bash
   docker run --rm --name sim-e2e-postgres \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=postgres \
     -p 5432:5432 \
     pgvector/pgvector:pg17
   ```

   Cleanup uses `DROP DATABASE ... WITH (FORCE)`, which requires PostgreSQL 13
   or newer and is supported by the pinned pgvector/PostgreSQL 17 image.

3. Install Chromium from `apps/sim`:

   ```bash
   bun run test:e2e:install-browsers
   ```

## Run the foundation

From `apps/sim`:

```bash
E2E_PG_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
  bun run test:e2e
```

The runner creates a unique `sim_e2e_<runId>` database, migrates it, starts the
Stripe fake and realtime, builds and starts Next.js, seeds the validated persona
world through production APIs plus narrow trusted arrangements, captures each
persona through the real login UI, runs Playwright on Node 22, then stops
services and drops only that guarded database.
Server telemetry currently shares the strict loopback Stripe-fake process; the
generic modular fake-service refactor remains scoped to the roadmap's
`e2e/06b-enterprise-integrations` phase.
An exclusive checkout-level orchestrator lock prevents concurrent runs from
racing on `.next`, the shared build cache, or the fixed app/realtime ports. The
lock records managed process groups, so recovery from an uncatchable
orchestrator termination kills verified stale descendants before admitting a
new writer.

On interruption, the runner launches a detached cleanup supervisor before
exiting. It terminates managed process groups, force-drops the guarded database,
and removes temporary auth/cloud-config directories. Repeated or opposite
signals remain on the same single-flight path until the supervisor owns the
lock, after which the foreground runner exits.
Cleanup failures retain the lock and require the reported resources to be
inspected and cleaned before manually removing `e2e/.cache/orchestrator.lock`.
Failure to start the detached cleanup supervisor also retains the lock.

Pass Playwright arguments after `--`:

```bash
bun run test:e2e -- --project=hosted-billing-chromium-navigation
bun run test:e2e -- --grep "unauthenticated"
```

Projects form a dependency chain to keep shared boundaries serialized. Selecting
the personas project therefore also runs navigation, authorization, and
workflows by default, and an upstream failure skips its dependents. For focused
local iteration, `--no-deps` is explicitly supported:

```bash
bun run test:e2e -- --project=hosted-billing-chromium-personas --no-deps
```

`--no-deps` requires exactly one explicit canonical project. It skips only
Playwright project dependencies; the guarded one-shot stack still performs full
seed and auth setup. Do not use it for full verification; the runner rejects it in CI.

For a local follow-up run, reuse only a verified build while still creating a
new database, Stripe fake, app, realtime process, and browser run:

```bash
bun run test:e2e -- --reuse-build --project=hosted-billing-chromium-navigation
```

## Settings navigation contracts

Step 3 owns three literal acceptance datasets in
`e2e/settings/navigation/contracts.ts`: canonical sidebar sections, special
route outcomes, and representative persona visibility. They are intentionally
independent of production navigation metadata. When product copy, routes, or
visibility change, update the product and these expectations together rather
than generating expectations from the implementation.

Run only the navigation contracts during local iteration:

```bash
bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-navigation --no-deps \
  e2e/settings/navigation
```

The complete navigation project includes foundation safety and unauthenticated
smoke coverage. On the Step 3 reference run, one worker completed its 123 tests
in 1.7 minutes and the cache-hit orchestrator in 5 minutes 10 seconds. Two
workers completed the same retry-free project in 55.3 seconds and the
cache-hit orchestrator in 4 minutes 25 seconds, so the project retains two
workers. Foundation coverage passed in both measurements. The final
post-review dependency chain passed all 139 navigation, workflow, persona, and
isolation tests in 1.3 minutes of Playwright time.

The full chain's isolated browser contexts share a loopback address, so the E2E
app raises Better Auth's generic request ceiling without disabling its limiter.
That override fails closed unless the exact hosted E2E profile, E2E auth origin,
and loopback `sim_e2e_*` database are all present; normal deployments retain
Better Auth's defaults.

## Settings authorization contracts

Step 4 owns literal direct-route access, entitlement, and mutation-control
datasets in `e2e/settings/authorization/contracts.ts`. Existing Step 3
navigation positives are referenced by stable contract IDs instead of rerun.
The browser specs cover the remaining account, organization, and workspace
denials, paid Billing readiness, role-scoped mutation chrome, and shared
unsaved-change behavior.

Run only these contracts during local iteration:

```bash
bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-authorization --no-deps \
  e2e/settings/authorization
```

The hosted profile enables Custom blocks with `DEPLOY_AS_BLOCK=true` only for
the Next.js build and app processes; migration, seed, auth capture, Playwright,
and realtime never receive the flag. The strict Stripe fake implements only the
invoice-list shape used by paid settings pages: an existing fake customer,
`limit=20`, `expand[0]=data.lines`, and an optional cursor. It returns an empty
Stripe list and rejects all extra or malformed request shapes.

Unsaved-change coverage intentionally stops at settings sidebar navigation,
the app's Settings Back action, and native `beforeunload`. Toolbar history and
credential, fork, or custom-block detail guards belong to later roadmap steps.
On the Step 4 reference run, two workers completed all 84 retry-free
authorization tests in 1.2 minutes and the cache-hit orchestrator in 4 minutes
42 seconds. The final dependency chain passed all 223 navigation,
authorization, workflow, persona, and isolation tests in 2.4 minutes of
Playwright time; the clean-build orchestrator completed in 8 minutes 25
seconds.

The cache lives under ignored `e2e/.cache/builds/`. A hit requires matching
source contents (including uncommitted/untracked files), build/public profile,
Node/Bun/Next versions, platform, `BUILD_ID`, and the cached artifact checksum.
Any mismatch performs and caches a fresh local build; only the most recent cache
entry is retained because this application's production artifact is several
gigabytes. CI rejects `--reuse-build` and does not copy or hash a disposable
cache artifact. Plain local runs also skip cache identity computation,
multi-gigabyte copying, and cache population; only an explicit `--reuse-build`
request pays those costs. Cache restore also removes abandoned temporary stores
from interrupted writes before accepting a hit. `--skip-build` remains unsupported.

Keep-stack/rerun supervision is intentionally unavailable. The initial safety
experiment requires descriptor ownership, mutation observation, state snapshots,
and teardown to ship as one unit; until all of those are proven, each invocation
uses the normal one-shot lifecycle.

Do not invoke `playwright test` directly. Raw Playwright bypasses environment,
database, process, sharding, and teardown guards; the config rejects runs that
were not launched by the orchestrator. Report and trace viewer commands remain
safe because they do not execute tests.

Sharding is supported only for the navigation project. The runner rejects
`--shard` for authorization, workflows, persona contracts, and the dedicated
two-worker cross-world isolation project. Project dependencies serialize
navigation, authorization, workflows, and persona contracts before the
isolation project opens its two-worker pool.

## Diagnostics

- HTML report: `playwright-report/`
- Traces and screenshots: `test-results/`
- App, realtime, migration, seed, auth-capture, and fake logs:
  `e2e/.runs/<runId>/logs/`
- Non-secret persona manifest and auth-capture failure screenshots:
  `e2e/.runs/<runId>/`

Open the report:

```bash
node ../../node_modules/@playwright/test/cli.js show-report playwright-report
```

Open a trace:

```bash
node ../../node_modules/@playwright/test/cli.js show-trace test-results/<test>/trace.zip
```

The runner starts every child process from a fresh, purpose-specific
environment. Next build receives deterministic sentinels instead of the run
database/fake endpoint; app, realtime, migrations, seeding, auth capture, and
Playwright each receive only their required values. Playwright receives the
non-secret manifest and storage-state directory, never passwords, the admin API
key, or the database URL. Next build/start shadow
keys found in local `.env*` files, while children that cannot load those files
omit denied keys entirely. Developer credentials are not used as test state or
written to reports. Named persona credentials and a separate all-synthetic-user
canary list live outside every child `HOME` in a private run directory. Auth
capture receives only the persona file, which is deleted immediately after
capture; storage states are mode `0600` and excluded from CI artifacts. Captured
passwords are loaded into orchestrator memory, then both secret files are
deleted before Playwright starts. After managed processes stop and logs flush,
the in-memory canary scans the manifest, logs, report files, and trace archives
and fails if a synthetic password, invitation token, or runtime secret escaped
the excluded private directories. Cancelled CI runs do not upload unscanned
diagnostics, and an unreadable canary or incomplete archive scan causes all
potentially unscanned diagnostic roots to be scrubbed. CI uploads failure
diagnostics only when the runner wrote its successful scan marker. The fixed
foundation smoke password is public test input and is intentionally not a
canary, so expected login traces remain useful. Storage-state session cookies are intentionally not canaried
because authenticated Playwright traces contain them by design; they are
synthetic and invalid once the run database is dropped.
Fresh-session recapture is deliberately deferred. Future membership-mutation
coverage must explicitly restore a private credential handoff and re-review its
access boundary rather than assuming credentials persist through Playwright.

E2E builds verify the pinned Bun executable plus reviewed sandbox-bundle
source, direct dependency, and output fingerprints. They also regenerate the
bundles into a temporary directory and require those fresh outputs to match the
reviewed fingerprints without modifying committed `.cjs` files.
`bun run build:sandbox-bundles:integrity` is the explicit maintenance command
that regenerates bundles and their reviewed integrity manifest together.
Unrelated monorepo lockfile changes do not invalidate the reviewed fingerprint;
the fresh-output comparison detects transitive changes that alter a bundle.

Reset/reseed cleanup remains deferred with keep-stack supervision. Ordinary
runs own a unique guarded database and remove it wholesale rather than carrying
untested row-level deletion code.

Provider log scans are diagnostic tripwires, not proof of zero egress. The
primary boundaries are the default-deny child environment, provider disabling,
loopback-only service bindings, guarded Stripe transport, disabled hosted
marketing tags, and a browser-context allowlist that rejects every HTTP(S)
origin outside the app and realtime service.
