---
name: validate-selector
description: Audit a Sim dynamic selector across its declaration, browser-safe manifest, server attachment, provider primitive, and selectors.execute security boundary. Use when reviewing selector correctness, secret handling, scope authorization, or migration completeness.
argument-hint: <selector-key-or-service>
---

# Validate Selector

Validate the complete path, not only the provider adapter.

## Gather the path

Read:

- Every block, trigger, and connector field using the selector key.
- `apps/sim/lib/selectors/manifest.ts` and `types.ts`.
- `apps/sim/lib/selectors/context.ts`.
- The matching server attachment and any shared provider listing primitive.
- `apps/sim/lib/selectors/server/registry.ts`.
- The shared application executor, route contract, client transport, and focused tests when the
  finding concerns shared behavior.

Search literal API paths as well as TypeScript imports before deciding whether an old provider route
or contract is unused.

## Validate the declaration and manifest

- The key has exactly one classification and one attachment (`local` keys use the local registry).
- Allowed context is minimal and readiness matches the provider request.
- List, pagination, search, detail, unknown-detail, scope, and stale-time metadata match actual UX.
- `dependsOn` names the required source fields; canonical pairs contribute only their active member.
- Action/trigger and connector surfaces build the same canonical context.
- Exact `{{KEY}}` references remain unresolved in the browser; runtime references are omitted,
  while embedded interpolation is forwarded unresolved and rejected by the server executor.
- Query keys contain no context value, reference, credential ID, secret, or hash of one.

## Validate the server boundary

For provider and internal selectors, confirm the shared executor owns this order:

1. Session authentication before request parsing.
2. Canonical workflow/workspace loading and read authorization.
3. Manifest capability and exact-context allowlisting.
4. Exact environment-reference resolution on the server.
5. Credential use, workspace, and trusted provider/service binding.
6. Destination-policy enforcement before provider network access.
7. Provider/internal execution followed by explicit option projection and sanitization.

The attachment must not duplicate these shared checks. It must not accept a browser-provided module,
provider, service, operation kind, origin, or scope list.

Review its destination classification:

- `fixed` origins are code-defined.
- `credential-bound` origins are derived from or checked against the authorized credential.
- `user-controlled` destinations have an explicit policy for hidden use-only authentication and
  network safety.

Missing and inaccessible references, and missing, unauthorized, or provider-mismatched credentials,
must not become existence oracles. Hidden/server-only resolved plaintext, credentials, authentication
material, and raw upstream errors must not enter responses, query/cache/rate keys, selector result
caches, logs, audit metadata, redirects, or error messages. Browser-known literals and viewable
personal/shared values are not automatically protected plaintext, but the executor must still never
deliberately or wholesale echo selector context. Only intentionally projected, normalized
`{ id, label, meta? }` options and bounded cursors may cross the boundary.

Selector code must not introduce a context, token, or result cache. The sole existing cache
exception is authorized client-credential resolution after authorization and provider binding,
which may reuse the credential service's TTL-governed, lazily pruned process-local token cache. The
cache is not hard-bounded, the exception requires explicit security-owner acceptance, and selector
work must not expand it.

## Validate provider reuse and browser boundaries

- The attachment calls a server-only provider primitive, not a route handler or internal HTTP URL.
- A surviving provider route has a proven non-selector caller and delegates to the same primitive.
- There is no client provider selector module, selector-specific token request, or browser request to
  a provider-specific selector route.
- Internal selectors delegate to existing authorized use cases rather than querying protected data
  in the route or adapter.

## Tests and report

Use existing Vitest/route/React Query patterns. Preserve valuable provider tests, but do not demand a
per-selector authorization matrix. Shared executor tests should cover ordering, references,
credential binding, sanitization, and safe errors; adapter tests should cover only special provider
behavior.

Report critical, warning, and suggestion findings. Treat browser secret resolution, missing scope or
credential authorization, unsafe destination binding, provider payload passthrough, and plaintext
egress as critical.

Run the smallest relevant focused suites plus:

```bash
bun run --cwd apps/sim type-check
bun run check:api-validation:strict
bun run check:fork-dependent-coverage
bun run check:client-boundary
git diff --check
```

State which live-provider checks remain pending when disposable credentials are unavailable.
