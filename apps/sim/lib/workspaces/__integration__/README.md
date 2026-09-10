# Workflow import and workspace sync harness

Run from the repository root:

```sh
bun run test:workflow-sync
```

Requires Bun, installed workspace dependencies, and a running Docker daemon. The runner starts PostgreSQL 17 with pgvector on a random loopback port, applies the current schema, runs the tests, and removes the container. It never reads the application's database connection or mounts a database volume. Integration setup rejects nonlocal and nonfixture database names and enables the transaction tripwire.

The tests exercise real PostgreSQL transactions, locks, application authorization, v2 route adapters, API-key authentication, CLI subprocesses, and deployment outbox workers. HTTP callbacks to the separate realtime process use an authenticated local fixture. Provider discovery and failure cases have focused Vitest tests with controlled provider responses.

Coverage includes concurrent identical requests, reused request IDs with changed payloads, failure before commit, retries after lost responses, revoked access, mapping refusal, sanitized imports, regenerated block/edge/variable identities, inline tools, draft-only forks, push and pull from either side, inherited locks, stale previews, exclusions, deleted versus undeployed workflows, immutable deployment snapshots, deployment readiness, and pagination across microsecond timestamps. Copy lifecycle tests cover interrupted workers, checkpoint loss, changed source documents, partial failure and receipt recovery.

To add an integration scenario, place `*.integration.ts` beside this file. Create a fixture user and workspace, use generated IDs, and clean up that workspace and user in `afterAll`. Do not import the normal application test setup: its database mocks would defeat the concurrency checks. Keep external services on disposable local fixtures.

The harness tests against the expanded schema. Validate migration safety separately with `bun run check:migrations`; do not point this runner at an existing database to test deployment migrations.
