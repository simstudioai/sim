---
description: Isolated-vm sandbox worker security policy. Hard rules for anything that lives in the worker child process that runs user code.
paths:
  - "apps/sim/lib/execution/isolated-vm-worker.cjs"
  - "apps/sim/lib/execution/isolated-vm-host.cjs"
  - "apps/sim/lib/execution/isolated-vm-remote.ts"
  - "apps/sim/lib/execution/isolated-vm.ts"
  - "apps/sim/lib/execution/sandbox/**"
  - "apps/sim/sandboxes/**"
---

# Sim Sandbox — Worker Security Policy

The isolated-vm worker child process at
`apps/sim/lib/execution/isolated-vm-worker.cjs` runs untrusted user code inside
V8 isolates. The process itself is a trust boundary. Everything in this rule is
about what must **never** live in that process.

## Hard rules

1. **No app credentials in the worker process**. The worker must not hold, load,
   or receive via IPC: database URLs, Redis URLs, AWS keys, Stripe keys,
   session-signing keys, encryption keys, OAuth client secrets, internal API
   secrets, or any LLM / email / search provider API keys. If you catch yourself
   `require`'ing `@/lib/auth`, `@sim/db`, `@/lib/uploads/core/storage-service`,
   or anything that imports `env` directly inside the worker, stop and use a
   host-side broker instead. This includes the OS environment: the worker is
   spawned with the explicit allowlisted env from `buildWorkerEnv()` in
   `isolated-vm.ts` — never spawn it without an `env` option (Node would copy
   the app's full `process.env`, secrets included, into the worker).

2. **Host-side brokers own all credentialed work**. The worker can only access
   resources through `ivm.Reference` / `ivm.Callback` bridges back to the host
   process. Today the only broker is `workspaceFileBroker`
   (`apps/sim/lib/execution/sandbox/brokers/workspace-file.ts`); adding a new
   one requires co-reviewing this file.

3. **Host-side brokers must scope every resource access to a single tenant**.
   The `SandboxBrokerContext` always carries `workspaceId`. Any new broker that
   accesses storage, DB, or an external API must use `ctx.workspaceId` to scope
   the lookup — never accept a raw path, key, or URL from isolate code without
   validation.

4. **Nothing that runs in the isolate is trusted, even if we wrote it**. The
   task `bootstrap` and `finalize` strings in `apps/sim/sandboxes/` execute
   inside the isolate. They must treat `globalThis` as adversarial — no pulling
   values from it that might have been mutated by user code. The hardening
   script in `executeTask` undefines dangerous globals before user code runs.

## Why

A V8 JIT bug (Chrome ships these roughly monthly) gives an attacker a native
code primitive inside the process that owns whatever that process can reach.
If the worker only holds `isolated-vm` + a single narrow workspace-file broker,
a V8 escape leaks one tenant's files. If the worker holds a Stripe key or a DB
connection, a V8 escape leaks the service.

The original `doc-worker.cjs` vulnerability (CVE-class, 225 production secrets
leaked via `/proc/1/environ`) was the forcing function for this architecture.
Keep the blast radius small.

## Checklist for changes to `isolated-vm-worker.cjs`

Before landing any change that adds a new `require(...)` or `process.send(...)`
payload or `ivm.Reference` wrapper in the worker:

- [ ] Does it load a credential, key, connection string, or secret? If yes,
      move it host-side and expose as a broker.
- [ ] Does it import from `@/lib/auth`, `@sim/db`, `@/lib/uploads/core/*`,
      `@/lib/core/config/env`, or any module that reads `process.env` of the
      main app? If yes, same — move host-side.
- [ ] Does it expose a resource that's workspace-scoped without taking a
      `workspaceId`? If yes, re-scope.
- [ ] Did you update the broker limits (`IVM_MAX_BROKER_ARGS_JSON_CHARS`,
      `IVM_MAX_BROKER_RESULT_JSON_CHARS`, `IVM_MAX_BROKERS_PER_EXECUTION`) if
      the new broker can emit large payloads or fire frequently?
- [ ] Does the worker read a new env var? Add it to the `buildWorkerEnv()`
      allowlist in `isolated-vm.ts` **and** to the allowlist regression test in
      `isolated-vm.test.ts` — the worker does not inherit the app environment,
      so an un-allowlisted var is simply absent in the child. If the app owns
      its value, put it in `appWorkerEnv()` and add it with its accepted shape
      to `CLIENT_WORKER_ENV` in `isolated-vm-host.cjs`, so a remote worker
      gets the same value.
- [ ] Does the host send the worker a new message type? Add it to
      `ALLOWED_INBOUND_TYPES` in `isolated-vm-host.cjs`, or remote workers
      never receive it.

## Where the worker runs

The pool in `isolated-vm.ts` opens each worker either as a local child process
or, when `IVM_REMOTE_WORKER_URL` is set (with `IVM_REMOTE_WORKER_TOKEN`; a URL
without a valid token fails executions rather than falling back) and the
`isolated-vm-local-workers` kill switch is off, as a WebSocket connection to
`isolated-vm-host.cjs`, which runs the
same worker in a dedicated service that holds no platform credentials. Every
rule in this file applies in both modes.

- `fetch()` and brokers always run in the app. The host only relays the
  worker's messages, so it needs no network access of its own and never gets
  a broker implementation.
- A remote target never falls back to a local child process. An unreachable
  host fails executions with a system error; keep it that way.
- Changes to the worker message protocol must stay compatible with the
  previous release: the host and its clients roll out independently.

## What the worker *may* hold

- `isolated-vm` module
- Node built-ins: `node:fs` (only for reading the checked-in bundle `.cjs`
  files) and `node:path`
- The three prebuilt library bundles under
  `apps/sim/lib/execution/sandbox/bundles/*.cjs`
- IPC message handlers for `execute`, `cancel`, `fetchResponse`,
  `brokerResponse`

The worker deliberately has **no host-side logger**. All errors and
diagnostics flow through IPC back to the host, which has `@sim/logger`. Do
not add `createLogger` or console-based logging to the worker — it would
require pulling the main app's config / env, which is exactly what this
rule is preventing.

Anything else is suspect.
