---
paths:
  - "apps/sim/**"
---

# Sim App Architecture

## Core Principles
1. **Single Responsibility**: Each component, hook, store has one clear purpose
2. **Composition Over Complexity**: Break down complex logic into smaller pieces
3. **Type Safety First**: TypeScript interfaces for all props, state, return types
4. **Predictable State**: Zustand for global state, useState for UI-only concerns

## Root-Level Structure

```
apps/
├── sim/                 # this app (Next.js: UI + API routes + workflow editor)
│   ├── app/             # Next.js app router (pages, API routes)
│   ├── blocks/          # Block definitions and registry
│   ├── components/      # Shared UI (emcn/, ui/)
│   ├── executor/        # Workflow execution engine
│   ├── hooks/           # Shared hooks (queries/, selectors/)
│   ├── lib/             # App-wide utilities
│   ├── providers/       # LLM provider integrations
│   ├── stores/          # Zustand stores
│   ├── tools/           # Tool definitions
│   └── triggers/        # Trigger definitions
└── realtime/            # Bun Socket.IO server (collaborative canvas)

packages/                # @sim/* — audit, auth, db, logger, realtime-protocol,
                         # security, tsconfig, utils, platform-authz,
                         # workflow-persistence, workflow-types
```

## Package Boundaries

- `apps/* → packages/*` only. Packages never import from `apps/*`.
- `apps/realtime` avoids Next.js, React, the block/tool registry, provider SDKs, and the executor; never add `@/lib/webhooks/providers/*`, `@/executor/*`, `@/blocks/*`, or `@/tools/*` imports to any package it consumes. CI enforces this via `scripts/check-monorepo-boundaries.ts` and `scripts/check-realtime-prune-graph.ts`.

## Protected Application Operations

Every real operation on protected or persisted data crosses one authorized application boundary:

1. The surface authenticates its credential or trusted context and constructs a `Principal`.
2. A fixed, code-defined semantic operation declares minimum role, workspace-key policy, allowed principal kinds, and delegated services.
3. The application use case loads canonical context, checks asserted scope, authorizes current access, executes the manager/repository, projects semantic audit, and runs shared domain effects.
4. The surface presents its own internal, v2, Copilot, or tool result.

Routes and tools must not query protected data, authorize resources, implement business transactions, or record semantic audit. Application modules must not import `app/api/**`, `next/server`, route contracts/presenters, or Copilot handlers. Copilot must call the same domain use case through `createCopilotApplicationAdapter`; do not create a second Copilot business implementation. Atomic compound mutations need one top-level semantic application operation rather than sequential surface calls.

Ordinary internal and v2 routes use the shared JSON/binary route builders. Those builders already apply `withRouteHandler`; do not double-wrap them. Use raw `withRouteHandler` only for explicit protocol, streaming, large-body, multipart, or lifecycle exceptions, while keeping protected business work inside application use cases.

Use the `migrate-application-operation` skill before creating or migrating a protected endpoint, tool command, or resource method.

## The `'use client'` server boundary

Every export of a `'use client'` module becomes a *client reference* on the server — server-evaluated code (RSC pages/layouts, `prefetch.ts`, route handlers, block definitions, triggers) can only *render* it as a component or pass it as a prop, never *call* it (doing so throws at runtime, e.g. `tableKeys.list is not a function`; `next build` does not catch it). Keep server-importable query primitives (key factories, fetchers, mappers, constants) in non-`'use client'` modules — see `.claude/rules/sim-queries.md`. Enforced by `scripts/check-client-boundary-imports.ts`.

## The app/worker runtime boundary

Server code runs in two runtimes with **different environments**. The app container loads the
full env from `SIM_ENV_SECRET_ID` (Secrets Manager). Trigger.dev workers execute application
code directly and receive runtime configuration through Trigger.dev. At deployment,
`trigger.config.ts` calls `scripts/trigger-env-sync.ts` through the existing `syncEnvVars`
extension. It reads only the mapped combined secret's `AWSCURRENT` version, selects approved
platform variables in memory, validates them, and returns explicitly classified secret/public
entries. `DB_APP_NAME=sim-trigger` is fixed; the run `init` marker remains the source of runtime
detection. Reserved `TRIGGER_*` variables, deployment credentials, arbitrary source keys, and
customer credentials are never selected. Customer OAuth tokens and workspace/provider
credentials remain in the application database, decrypted by the existing runtime code.

```text
ECS boot:        environment secret -> runtime-secrets loader -> app process
Trigger deploy: environment secret -> worker policy/validation -> syncEnvVars -> Trigger runtime
                                     + preserved Trigger-owned settings
```

### Worker synchronization ownership and rollout

The mapping is deliberately closed: `preview` with branch `dev-sim` reads `/dev/sim/env-vars`,
`staging` without a branch reads `/staging/sim/env-vars`, and `prod` without a branch reads
`/production/sim/env-vars`. Unknown targets fail before AWS access; no preview-parent writes.
The deployment entrypoint must supply `SIM_TRIGGER_ENV_SYNC_PROJECT_REF` (the approved project,
checked against the callback project) and `SIM_TRIGGER_ENV_SYNC_REGION` (the source region).
These deployment-only controls are not exported to workers. No `NODE_ENV` inference or ambient
source-value fallback is permitted. An unconfigured deployment fails closed; coordinate this
change with the separate deployment-orchestration work before merging/enabling it.

`WORKER_CONFIGURATION` is the reviewable names/classification/consumer policy. Shared capability
fields, OAuth application registrations, and platform LLM pools come from the existing registry.
Additional groups document their worker consumer and requiredness. Required source settings
include app/auth URLs, encryption/internal authentication, and explicit billing/enterprise flags
(`false` is valid). Capability validators reject incomplete active providers. The source subset
and effective worker configuration are checked so missing values cannot hide behind old values
or silently switch storage/OCR backends. Optional absence is allowed; configured features must
still be usable. Before enabling each target, its owner must approve a names-only source/target
inventory, a supported capability baseline, and the ownership exceptions. Validation does not
prove that a configured endpoint is reachable or a credential is authorized.

Each target currently preserves the conservative `WORKER_OWNED` list: database URLs (including
role/replica/sub-pool URLs), `SIM_DB_ROLE`, Redis URL/TLS server name, PII endpoint, and Grafana
telemetry settings. The effective database must already be usable. These exceptions apply even
when a source value exists; transfer ownership only through an explicitly reviewed policy change.
The list is a preservation policy, not a claim about the contents of a live target. Staging/prod
project references and deployment entrypoints still require live verification. Telemetry setup,
DB clients, ECS hydration and worker initialization are unchanged.

Omitted optional keys preserve existing Trigger values, with a names-only notice when the key
was present in the callback's current environment. This is not deletion and does not transfer
ownership. Removed/renamed variables require owner-reviewed retirement in Trigger, including
preview inheritance checks so deleting an override cannot resurrect a parent value. Existing
public variables needing secret classification must be reviewed: Trigger's secret classification
is a creation-time property, so returning `isSecret` must not be treated as an in-place migration.

Reuse the deployment identity's existing Trigger authentication and AWS default credential chain.
Grant it `secretsmanager:GetSecretValue` on the exact environment secret ARN, and `kms:Decrypt`
only for its customer-managed key when required. No worker Secrets Manager permission is needed.
Runtime AWS credentials selected from the source are platform configuration; runner credentials
are never copied from `process.env`. IAM definition location and staging/prod deploy wiring are
external prerequisites owned by the separate investigation. This step belongs inside every
existing Trigger deployment, after authentication and before the release is accepted. Do not
use `--skip-sync-env-vars` or tolerate nonzero exits. Trigger 4.5.12 catches callback exceptions,
so the adapter logs only controlled categories/names and exits the deploy process with code 1.
CLI environment-import failures must also fail deployment. Never log source objects or SDK/parser
errors, hydrate the deployer, write dotenv/manifests, or pass secrets as image/build arguments.

Roll out preview/dev-sim, then staging, then production. Synchronization is deployment-time;
rotation without deployment is outside this mechanism. Env import and code promotion are not
atomic: even a later failed build can leave updated configuration. Running/checkpointed jobs
and cached application clients are not guaranteed to adopt updates. Allow old credentials to
remain valid until executions finish, or use a separately authorized drain procedure. Optional
omission and code rollback do not restore prior values.

One disposable non-production smoke test is sufficient after access and ownership approval:
use a disposable Trigger project and an isolated non-production AWS account with fake platform
configuration at `/dev/sim/env-vars`. Supply that project and region through the deployment
controls, preseed fake Trigger-owned configuration, and invoke the existing deployment path for
`preview/dev-sim`. Verify creation,
update, unrelated-variable preservation and optional omission. Assert a fresh job sees expected
values without printing them. Check build artifacts and logs for the fake marker, explicitly
remove test variables (including inherited preview values), and delete the disposable secret
and project. Do not point the smoke test at an environment's real combined secret. Do not add
this live test to CI or use production credentials. Automatic deletion/rotation behavior is not
implemented; any explicit deletion test must account for preview inheritance.

References: [Trigger syncEnvVars](https://trigger.dev/docs/config/extensions/syncEnvVars),
[Trigger environment variables](https://trigger.dev/docs/deploy-environment-variables),
[AWS GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html).

So before replacing a worker's HTTP call to our own API with an in-process call, ask what env
that work reads *on the app side*. Anything gated by a `require*Capability` helper is the sharp
case: those **throw** when the variable is absent (`requireOAuthClientCapability` →
`EnvCapabilityConfigurationError`), and the throw may be caught and reported as something
unrelated — an in-worker OAuth refresh missing a provider's client pair reports every expired
credential as `Failed to refresh access token`, while a still-valid token hides the bug until it
lapses. The required step before such a conversion is verifying the dashboard env holds every
variable the moved code reads (for OAuth refresh: the `OAUTH_CLIENT_CAPABILITIES` key pairs in
`packages/deployment-config/src/env-capabilities.ts`).

An in-process conversion is safe when the same work already runs in that runtime (the agent
block has always called `executeProviderRequest` in-process, so router and evaluator joining it
is proven; connector sync refreshing OAuth tokens in-worker is what proved credential-token
resolution could move in-process), or when the caller and the callee are both the app (a route
calling a lib module, an RSC prefetch reading the data layer). It is not safe on reasoning
alone — verify the env, then convert.

## Feature Organization

Features live under `app/workspace/[workspaceId]/`:

```
feature/
├── components/          # Feature components
├── hooks/               # Feature-scoped hooks
├── utils/               # Feature-scoped utilities (2+ consumers)
├── feature.tsx          # Main component
└── page.tsx             # Next.js page entry
```

## Naming Conventions
- **Components**: PascalCase (`WorkflowList`)
- **Hooks**: `use` prefix (`useWorkflowOperations`)
- **Files**: kebab-case (`workflow-list.tsx`)
- **Stores**: `stores/feature/store.ts`
- **Constants**: SCREAMING_SNAKE_CASE
- **Interfaces**: PascalCase with suffix (`WorkflowListProps`)

## Utils Rules

- **Never create `utils.ts` for single consumer** - inline it
- **Create `utils.ts` when** 2+ files need the same helper
- **Check existing sources** before duplicating (`lib/` has many utilities)
- **Location**: `lib/` (app-wide) → `feature/utils/` (feature-scoped) → inline (single-use)
