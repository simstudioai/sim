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

On interruption, the runner launches a detached cleanup supervisor before
exiting. It terminates managed process groups, force-drops the guarded database,
and removes temporary auth/cloud-config directories even if another Ctrl-C
terminates the foreground package runner.

Pass Playwright arguments after `--`:

```bash
bun run test:e2e -- --project=hosted-billing-chromium-navigation
bun run test:e2e -- --grep "unauthenticated"
```

For a local follow-up run, reuse only a verified build while still creating a
new database, Stripe fake, app, realtime process, and browser run:

```bash
bun run test:e2e -- --reuse-build --project=hosted-billing-chromium-navigation
```

The cache lives under ignored `e2e/.cache/builds/`. A hit requires matching
source contents (including uncommitted/untracked files), build/public profile,
Node/Bun/Next versions, platform, `BUILD_ID`, and the cached artifact checksum.
Any mismatch performs and caches a fresh build. CI rejects `--reuse-build`.
`--skip-build` remains unsupported.

Keep-stack/rerun supervision is intentionally unavailable. The initial safety
experiment requires descriptor ownership, mutation observation, state snapshots,
and teardown to ship as one unit; until all of those are proven, each invocation
uses the normal one-shot lifecycle.

Do not invoke `playwright test` directly. Raw Playwright bypasses environment,
database, process, sharding, and teardown guards; the config rejects runs that
were not launched by the orchestrator. Report and trace viewer commands remain
safe because they do not execute tests.

Sharding is supported only for the navigation project. The runner rejects
`--shard` for workflows, persona contracts, and the dedicated two-worker
cross-world isolation project.

## Diagnostics

- HTML report: `playwright-report/`
- Traces and screenshots: `test-results/`
- App, realtime, migration, seed, auth-capture, and fake logs:
  `e2e/.runs/<runId>/logs/`
- Non-secret persona manifest and post-login auth-capture screenshots:
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
written to reports. Synthetic persona passwords live in a private run-home file
and are removed with the auth/cloud-config directory during teardown.

E2E builds verify the reviewed sandbox-bundle source/dependency/output
fingerprint and never regenerate committed `.cjs` files. Regeneration remains an
explicit repository maintenance operation.

Provider log scans are diagnostic tripwires, not proof of zero egress. The
primary boundaries are the default-deny child environment, provider disabling,
loopback-only service bindings, and guarded Stripe transport.
