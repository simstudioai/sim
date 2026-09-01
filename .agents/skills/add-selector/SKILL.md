---
name: add-selector
description: Add or update a Sim dynamic selector using the shared manifest, server attachment, and selectors.execute path. Use for provider-backed, internal, or local option lists referenced by block, trigger, or connector selectorKey fields.
argument-hint: <selector-key>
---

# Add Selector

Dynamic selectors expose option metadata while a workflow or connector is being configured. Every
remote selector executes through the authorized `selectors.execute` application operation; the
browser never resolves credentials or calls a provider directly.

## Read the shared boundary

Before editing, read:

- `apps/sim/lib/selectors/types.ts`
- `apps/sim/lib/selectors/manifest.ts`
- `apps/sim/lib/selectors/context.ts`
- `apps/sim/lib/selectors/server/types.ts`
- `apps/sim/lib/selectors/server/registry.ts`
- `apps/sim/hooks/queries/selectors.ts`

Then read the nearest existing selector attachment and the block, trigger, or connector declaration
that will consume the key.

## Classify the selector

- `provider-server`: contacts an external provider or uses provider credentials.
- `internal-server`: reads protected Sim data through an existing authorized application use case.
- `local`: pure browser-safe data with no protected data, credentials, references, or network I/O.

Add every key to the browser-safe manifest in `lib/selectors/manifest.ts`. `SelectorKey` derives from
that manifest; do not maintain a second union. Manifest entries contain data only: allowed context,
readiness, scope kinds, list/search/detail capabilities, and stale time. Do not import provider SDKs,
credentials, server helpers, or attachment functions into the manifest.

## Build context from active values

Declare `dependsOn` on the consuming sub-block or connector field. The shared context builder sends
only declared, active dependencies:

- Canonical basic/advanced pairs contribute the active value under their canonical key.
- Action and trigger modes contribute only fields active on that surface.
- Exact environment references such as `{{GMAIL_CREDENTIAL_ID}}` remain unresolved in the browser.
- Runtime block-output references are not selector context.
- Embedded environment interpolation such as `https://{{HOST}}/path` is unsupported.
- `impersonateUserEmail` is the one explicit compatibility hint projected when the manifest allows
  it, even when it is absent from `dependsOn`.

Add a new `SelectorContextKey` only when the value is a real, reusable selector dependency. Allow it
explicitly on each relevant manifest entry. Never send a full block or connector configuration.

## Add the server attachment

For `provider-server`, add the service's attachment map under
`apps/sim/lib/selectors/server/providers/` and include it in the exhaustive server registry. For
`internal-server`, add the attachment in `apps/sim/lib/selectors/server/internal.ts`. Local keys use
the exhaustive browser-safe registry in `apps/sim/lib/selectors/client/local.ts` and never enter the
server registry. A provider attachment declares:

- For stored credentials, a credential policy with the exact context field and trusted
  `serviceIds`. Raw-connection selectors instead validate the connection material projected from
  their allowed context and bind it to a deliberate destination policy.
- Destination policy: `fixed`, `credential-bound`, or `user-controlled`.
- A list/detail adapter that explicitly projects `id`, `label`, and allowlisted scalar `meta`.

Stored credentials must pass actor-use, workspace, and provider/service binding checks. Do not trust
a provider, service, operation kind, origin, or module name supplied by the browser.

Choose the destination policy deliberately:

- `fixed`: provider origin is code-defined.
- `credential-bound`: origin/account/site comes from, or is verified against, the authorized
  credential.
- `user-controlled`: the user selects the destination. Hidden use-only authentication requires an
  explicit security policy; do not combine it with an arbitrary destination by default.

Reuse or extract a server-only provider listing primitive. If an existing provider route has
non-selector callers, keep the route as a thin caller of that primitive. If it is selector-only,
move the logic and remove the obsolete route and contract. Never import a route handler or make an
internal HTTP request from an attachment.

The attachment must return normalized selector results only. It must never deliberately or
wholesale echo selector context, and hidden/server-only resolved material, credential IDs, tokens,
and authentication secrets must never cross the response boundary. Browser-known literals and
viewable personal/shared values are not automatically server-only secrets, but they may appear in
an option only when the adapter intentionally projects them as provider resource metadata. Let the
shared executor own scope authorization, exact-reference resolution, credential authorization,
error projection, and output sanitization; adapters must pass and preserve the executor's abort
signal during provider work.

## Wire the UI declaration

Point the block, trigger, or connector field at `selectorKey` and declare its `dependsOn` fields.
Keep connector selector/manual canonical pairs and fork reconfiguration behavior intact. Static
`options` stay local and need no selector.

Do not add:

- A module under `hooks/selectors/providers` or any client provider fetcher.
- A provider-specific React Query key.
- A selector-specific OAuth-token request.
- A selector-only API route when the provider primitive can be called directly.

All server selectors use the shared POST contract and React Query facade. Query identities must stay
opaque and must not include context values, references, credential IDs, secrets, or their hashes.
Selector code must not add context, token, or result caches. The sole existing cache exception is
authorized client-credential resolution after authorization and provider binding: it may reuse the
credential service's TTL-governed, lazily pruned process-local token cache. This exception requires
explicit security-owner acceptance; do not broaden it or describe it as hard-bounded.

## Focused validation

Follow nearby Vitest and route-test style. Do not add an authorization matrix for every ordinary
provider attachment; the shared executor tests own shared security behavior.

Add a focused adapter test when behavior is special, such as pagination, nontrivial destination
binding, provider-specific projection, or a raw-connection policy. For an ordinary fixed-origin OAuth
list, manifest/registry exhaustiveness plus an existing provider primitive test is usually enough.

Run the smallest relevant set, then:

```bash
bunx vitest run <focused selector tests>
bun run --cwd apps/sim type-check
bun run check:fork-dependent-coverage
bun run check:client-boundary
git diff --check
```

Confirm there is no browser-side provider call, every server key has one attachment, and every
returned option is explicitly projected.
