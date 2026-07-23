# Sim browser E2E

This directory contains the reusable full-stack Playwright harness. It runs the
production Next.js app, realtime, deterministic external fakes, and a migrated
per-run pgvector database.

For the cross-contract decision guide used when settings behavior changes, see
[`MAINTENANCE.md`](MAINTENANCE.md).

## One-time setup

0. Install Node 22 and Bun. Playwright workers require Node 22; set
   `E2E_NODE_BINARY` to an alternate Node 22 executable when `node` on `PATH`
   points elsewhere.

1. Map the hosted E2E origin to loopback:

   ```bash
   echo "127.0.0.1 e2e.sim.ai mcp.e2e.sim.ai" | sudo tee -a /etc/hosts
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

## Run the complete suite

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
Server telemetry shares the strict loopback Stripe-fake process.
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
the personas project therefore also runs navigation, authorization, credential
workflows, and general workflows by default, and an upstream failure skips its
dependents. For focused local iteration, `--no-deps` is explicitly supported:

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

The navigation suite owns three literal acceptance datasets in
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
smoke coverage.

The full chain's isolated browser contexts share a loopback address, so the E2E
app raises Better Auth's generic request ceiling without disabling its limiter.
That override fails closed unless the exact hosted E2E profile, E2E auth origin,
and loopback `sim_e2e_*` database are all present; normal deployments retain
Better Auth's defaults.

## Settings authorization contracts

The authorization suite owns literal direct-route access, entitlement, and
mutation-control datasets in `e2e/settings/authorization/contracts.ts`.
Existing navigation positives are referenced by stable contract IDs instead of
being rerun.
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
the app's Settings Back action, and native `beforeunload`. Credential detail
specs add in-app and popstate guards. Toolbar history and fork or custom-block
detail guards remain outside the current browser contract.

## Settings credential workflows

The credentials suite owns real Secrets and personal/workspace API-key
mutations under `e2e/settings/credentials`. It references canonical
permission-group and mutation-control proof IDs instead of rerunning those
browser cases.

Run only the credential workflows during local iteration:

```bash
bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-credentials --no-deps \
  e2e/settings/credentials
```

Credential tests use one worker and unique resources with same-test cleanup.
The API-key policy case resets and verifies
`allowPersonalApiKeys=true` before and after its assertions; unrelated Secrets
tests do not mutate that shared setting. This policy also affects runtime API-key
authentication, whose direct coverage remains outside the credentials browser
scope.

The credentials project deliberately disables traces, screenshots, videos, and
test-authored attachments. Playwright reports action arguments, traces include
network bodies and DOM snapshots, and API-key creation renders plaintext once.
Secret values are therefore generated and applied inside the browser without
crossing Playwright arguments. Secret-bearing same-origin verification and
replace-all cleanup also remain browser-resident and return only status,
presence, and fixed-size fingerprints. Blurred secret controls keep plaintext
out of the DOM, and project teardown redacts credential-shaped values from
Playwright's automatic failure context before it is written. API-key tests never
read the create response body or reveal value and verify only masked list
metadata.

The final leak scan still inspects HTML reports, logs, and ZIP entries. In
addition to seeded password/token canaries, it rejects complete generated API
key and versioned E2E runtime-secret patterns. ZIP entries and names are scanned
independently, and a detected leak reports only sanitized artifact identifiers
before diagnostics are scrubbed.

## People and access-control workflows

The workflows suite owns real workspace-invitation, organization-invitation,
member-role, member-removal, and Enterprise permission-group lifecycles under
`e2e/settings/workflows`.

Run only these workflows during local iteration:

```bash
bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-workflows --no-deps \
  e2e/settings/workflows
```

The project is serial and uses unique invitation emails and group names. Every
mutation registers LIFO cleanup before the first click. The real-member case
also restores its organization membership, explicit Read anchor, absent
secondary grant, active organization, and seat baseline, so repeat runs do not
depend on test order.

Member rows are accessible groups named by email, nested under count-free
`Teammates`, `Members`, or workspace regions. Teammates, organization members,
and Access Control expose fail-closed loading/error/ready states; tests do not
locate mutable count text.

The people workflow disables traces because the Teammates API necessarily
returns pending invitation tokens to the application. Tests never parse that
token-bearing response, invoke Copy invite link, or issue an extra
workspace-invitation list request. Token-free organization rosters are used for
safe invitation IDs, kinds, roles, and grants. Failure-only screenshots remain
enabled because invitation tokens are never rendered. Other workflow files keep
failure traces unless they carry a documented sensitive boundary.

Invitations exercise the real mail-rendering path. The hermetic app and build
environments expose none of the Resend, SES, SMTP, Azure ACS, or Gmail provider
credentials, so the mailer uses its documented mock-success behavior without
external delivery.

Permission-group enforcement is verified in fresh browser contexts because the
config is database-resolved and cached by client queries rather than stored in
Better Auth claims. The workflow adds its target member before enabling any
restrictions, deletes the group atomically, and then proves unrestricted
Read-authority readiness again.

## Enterprise integration workflows

Independent SAML, data-retention, and MCP lifecycles run in the same
single-worker workflows project. Each case uses `enterpriseOrganizationAdmin`
in `settings-primary`, registers LIFO cleanup before its first mutation, and
uses the authenticated persona request context for same-origin discovery and
restoration.

The SAML case creates a pending provider with `.invalid` issuer and entry-point
URLs and a public certificate from Node's reviewed public root store. No private
key is committed or generated. The test never attempts SSO login, provider
egress, or DNS resolution. It proves only the pending state and the presence of
TXT instructions; it never parses or logs the verification response body.
Traces and video remain off, and the test reloads immediately after checking the
instruction region so the verification value cannot remain in a failure
screenshot. Certificates, verification tokens, and token-bearing response
bodies must never be attached to reports or copied into logs.

Better Auth native domain verification is controlled independently by
`SSO_DOMAIN_VERIFICATION_ENABLED` and defaults off for upgrades and self-hosted
deployments. Migration 0266 has a one-shot legacy-data gate: when the migration
is not yet journaled and the legacy provider table exists, the migration
process acquires the SSO mutation advisory lock, requires
`SSO_PROVIDER_WRITES_QUIESCED=true` even if that table is empty, and runs the
public-suffix/account-link audit before applying schema changes.
The flag is an operator acknowledgement, not a lock: the old deployment must
actually have SSO/provider mutation traffic disabled from audit through
migration because it may not participate in the advisory-lock protocol.

Configure `SSO_PROVIDER_WRITES_QUIESCED` and
`SSO_AUDIT_APPROVED_PROVIDER_IDS` independently in the protected staging and
production GitHub environments whose databases predate 0266. The development
migration job currently uses `db:push`, not the versioned `migrate.ts` path, so
it does not execute this one-shot gate; audit, repair, or reset persistent
legacy development data before that schema push. The approval list records
only explicit retain-or-migrate decisions for existing Better Auth account
links and sessions. Unapproved links must be migrated or removed and their
sessions revoked. Legacy user-scoped providers must be assigned to an audited
organization or removed. The blocking gate stops after 0266 is journaled;
later SSO audits are operator reports and do not block unrelated migrations
merely because healthy providers have linked users or the public suffix list
changed.

Domain ownership is a separate decision. After 0266, backfill only providers
whose ownership evidence was independently approved, perform the update
transactionally, and read it back. Keep unknown rows at `domain_verified=false`.
Successful live TXT verification is still required before enabling
`SSO_DOMAIN_VERIFICATION_ENABLED`; neither linked-account approval nor migration
success proves domain ownership. The hermetic profile sets verification to true
only for its isolated world. Providers with linked Better Auth accounts cannot
change issuer/domain or be deleted until an operator completes the documented
account-link and session migration.

Rehearse the legacy audit, empty-table quiescence block, linked-account
approval, migration constraints/indexes/default, and post-0266 short-circuit
against the local pgvector instance:

```bash
E2E_PG_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
  bun run --cwd packages/db db:rehearse-sso-migration
```

Better Auth 1.6.13 does not honor explicit `requestSignUp`
for SAML callbacks, so implicit signup remains enabled only behind the
verified-domain gate to preserve intended JIT organization provisioning;
`trustEmailVerified` changes from its compatibility value to false only when
verified-domain enforcement is active. Verification requests retain Better Auth's
creator identity requirement in addition to organization owner/admin
authorization. If the creator leaves, recovery is an authorized delete and
recreate by the next configuring admin after any linked accounts and sessions
have been explicitly migrated. Successful live TXT
verification is a manual release check; hermetic browser coverage never
performs it.

The MCP fake binds an ephemeral listener to numeric `127.0.0.1` and advertises
`http://mcp.e2e.sim.ai:<port>/mcp`. The production app receives only the
`mcp.e2e.sim.ai` allowlist; `E2E_MCP_SERVER_URL` is a non-secret Playwright-only
value and is absent from build, app, realtime, migration, seed, and auth-capture
environments. The browser first proves local denial of a non-allowlisted
`.invalid` URL without test/create traffic, then performs real connection
tests, create-or-soft-delete revival, deterministic `e2e_lookup` discovery,
edit/reprobe, and delete. Cleanup lists active run-prefixed rows and deletes
them through the scoped production API. The fake log records only sequence,
method/path, JSON-RPC method, status, and a session-safe label—never headers,
bodies, credentials, or raw session IDs—and is included in normal leak scanning.

The retention case captures the complete configured snapshot before mutation.
Every browser and cleanup PUT omits `piiRedaction`, preserves unrelated
configured values, and carries the complete concrete retention override array.
It restores the exact seeded 30-day log, 90-day soft-delete, 30-day task, null
PII, and empty-override baseline. The orchestrator's trusted post-run database
probe independently requires that baseline after Playwright finishes.

Run the three workflows together or focus one file:

```bash
bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-workflows --no-deps \
  e2e/settings/workflows/{sso,data-retention,mcp}.spec.ts

bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-workflows --no-deps \
  e2e/settings/workflows/sso.spec.ts

bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-workflows --no-deps \
  e2e/settings/workflows/data-retention.spec.ts

bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-workflows --no-deps \
  e2e/settings/workflows/mcp.spec.ts
```

To check repeatability, run all three twice in one orchestrated single-worker
stack. Retries are fixed to zero by the runner:

```bash
bun run test:e2e -- --reuse-build \
  --project=hosted-billing-chromium-workflows --no-deps --repeat-each=2 \
  e2e/settings/workflows/{sso,data-retention,mcp}.spec.ts
```

The one-shot run still owns and drops its unique guarded database; do not invoke
raw `playwright test`.

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

Keep-stack/rerun supervision is intentionally unavailable. A safe implementation
requires descriptor ownership, mutation observation, state snapshots, and
teardown to ship as one unit; until all of those are proven, each invocation
uses the normal one-shot lifecycle.

Do not invoke `playwright test` directly. Raw Playwright bypasses environment,
database, process, sharding, and teardown guards; the config rejects runs that
were not launched by the orchestrator. Report and trace viewer commands remain
safe because they do not execute tests.

Sharding is supported only for the navigation project. The runner rejects
`--shard` for authorization, credentials, workflows, persona contracts, and
the dedicated two-worker cross-world isolation project. Project dependencies
serialize navigation, authorization, credentials, workflows, and persona
contracts before the isolation project opens its two-worker pool.

Browser specs must not use `test.only`, unexplained skips, arbitrary browser
sleeps, CSS-class assertions, shared mutable fixtures, test-local environment
bypasses, retry overrides, or worker overrides. Sensitive artifact suppression
must have a security reason and corresponding safety coverage.

## Stability gate and required CI

Retries remain fixed at zero. The stability gate is
five Playwright executions per test against one healthy production stack, not
five builds or five CI workflows. For an unscoped `--repeat-each`, the
orchestrator runs each canonical project sequentially with dependencies
suppressed after it has established their canonical order. Playwright otherwise
repeats the terminal project but runs dependency projects only once:

```bash
rm -rf e2e/.cache/builds
bun run test:e2e -- --reuse-build
bun run test:e2e -- --reuse-build --repeat-each=5
```

The first command must record a verified cache miss, build, and store. Make no
tracked or untracked source change under the hashed app/package trees before
the second command; it must hit the same source/profile/`BUILD_ID`, then create
a new guarded database, seed/auth state, and app/realtime boot for all five
repetitions. A failure invalidates the gate: fix the cause, rerun focused proof,
then restart the complete gate from repetition one. Do not substitute retries.

Ordinary PR CI runs the complete suite once. `Settings E2E` is a blocking job
on the same Blacksmith/GitHub provider switch as the production app build; the
GitHub fallback uses the paid high-memory runner. Pull-request workflows do not
ignore Markdown or docs-only changes because a missing required context would
leave those PRs permanently blocked. This intentionally spends the full CI
cost on every PR to a protected target. Failure diagnostics upload only after
the leak-scan marker is present.

If retries are ever introduced, the only sanctioned policy is `retries: 1`
together with Playwright `failOnFlakyTests: true`. The retry may collect
diagnostics and classify the flake, but the required check must still fail.

Observe the exact `Test and Build / Settings E2E` context on the latest staging
and main PR commits before configuring it as required for each protected branch.
Those branch-protection changes are manual repository operations.

## Adding another browser suite

Create feature tests under `e2e/<feature>/` and compose their scenario from the
existing `E2EWorld` factories. Reuse a deployment profile, Better Auth storage
states, external fakes, browser-network guard, cleanup registry, diagnostics,
and one-shot lifecycle instead of copying the harness.

Join an existing Playwright project only when the new suite has the same
deployment profile, process topology, isolation requirements, mutation
coupling, worker budget, artifact policy, and CI cadence. Otherwise add a
separate project/job with an explicit worker/shard and diagnostics policy.

## Coverage boundaries

The required suite is the hosted, billing-enabled Chromium acceptance gate. It
does not claim real payment execution, real email delivery, live SSO login or
TXT verification, destructive fork synchronization, self-hosted behavior,
billing-disabled behavior, or cross-browser coverage. Add those as explicit
profiles or manual release checks rather than hidden variants of this gate.

Production SSO quiescence, migration approval, domain-ownership backfill and
read-back, live TXT proof, and branch-protection configuration remain manual
operational gates. Their absence from browser automation is intentional and
must not be mistaken for evidence that the operation is unnecessary.

## Diagnostics

- HTML report: `playwright-report/`
- Traces and screenshots: `test-results/`
- App, realtime, migration, seed, auth-capture, and fake logs:
  `e2e/.runs/<runId>/logs/`
- Non-secret persona manifest and auth-capture failure screenshots:
  `e2e/.runs/<runId>/`

The credentials project keeps the HTML report, redacted automatic error
contexts, and redacted service logs but does not produce browser traces,
screenshots, videos, or test-authored attachments.

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
