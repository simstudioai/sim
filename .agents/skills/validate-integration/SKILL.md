---
name: validate-integration
description: Validate an existing Sim integration (tools, block, registry, and resolved-secret/model-input boundaries) against the service's API docs and Sim execution conventions
argument-hint: <service-name> [api-docs-url]
---

# Validate Integration Skill

You are an expert auditor for Sim integrations. Your job is to thoroughly validate that an existing integration is correct, complete, and follows all conventions.

## Your Task

When the user asks you to validate an integration:
1. Read the service's API documentation (via WebFetch or Context7)
2. Read every tool, the block, and registry entries
3. Cross-reference everything against the API docs and Sim conventions
4. Report all issues found, grouped by severity (critical, warning, suggestion)
5. Fix all issues after reporting them

## Step 1: Gather All Files

Read **every** file for the integration — do not skip any:

```
apps/sim/tools/{service}/          # All tool files, types.ts, index.ts
apps/sim/blocks/blocks/{service}.ts # Block definition
apps/sim/tools/registry.ts          # Tool registry entries for this service
apps/sim/blocks/registry-maps.ts    # Block + meta registry entry (BLOCK_REGISTRY / BLOCK_META_REGISTRY)
apps/sim/components/icons.tsx        # Icon definition
apps/sim/lib/auth/auth.ts           # OAuth config — should use getCanonicalScopesForProvider()
apps/sim/lib/oauth/oauth.ts         # OAuth provider config — single source of truth for scopes
apps/sim/lib/oauth/utils.ts         # Scope utilities, SCOPE_DESCRIPTIONS for modal UI
packages/deployment-config/src/env-capabilities.ts # OAuth client runtime capability source of truth
apps/sim/lib/core/config/env.ts     # Runtime env schema for capability fields
packages/sim-setup/src/capability-config.ts # Exhaustive CLI input-mode mapping for OAuth fields
packages/deployment-config/src/integrations.json # Generated client-safe integration catalog
packages/deployment-config/src/service-account-providers.generated.ts # Generated provider-ID facts
packages/deployment-config/src/service-account-metadata.ts # Handwritten deployment policy
```

## Step 2: Pull API Documentation

Fetch the official API docs for the service. This is the **source of truth** for:
- Endpoint URLs, HTTP methods, and auth headers
- Required vs optional parameters
- Parameter types and allowed values
- Response shapes and field names
- Pagination patterns (which param name, which response field)
- Rate limits and error formats

### Hard Rule: No Guessed Response Schemas

If the official docs do not clearly show the response JSON shape for an endpoint, you MUST tell the user instead of guessing.

- Do NOT assume field names from nearby endpoints
- Do NOT infer nested JSON paths without evidence
- Do NOT treat "likely" fields as confirmed outputs
- Do NOT accept implementation guesses as valid just because they are defensive

If a response schema is unknown, the validation must explicitly call that out and require:
1. sample responses from the user,
2. live test credentials for verification, or
3. trimming the tool/block down to only documented fields.

## Step 3: Validate Tools

For **every** tool file, check:

### Tool ID and Naming
- [ ] Tool ID uses `snake_case`: `{service}_{action}` (e.g., `x_create_tweet`, `slack_send_message`)
- [ ] Tool `name` is human-readable (e.g., `'X Create Tweet'`)
- [ ] Tool `description` is a concise one-liner describing what it does
- [ ] Tool `version` is set (`'1.0.0'` or `'2.0.0'` for V2)

### Params
- [ ] All required API params are marked `required: true`
- [ ] All optional API params are marked `required: false`
- [ ] Every param has explicit `required: true` or `required: false` — never omitted
- [ ] Param types match the API (`'string'`, `'number'`, `'boolean'`, `'json'`)
- [ ] Visibility is correct:
  - `'hidden'` — ONLY for OAuth access tokens and system-injected params
  - `'user-only'` — for API keys, credentials, and account-specific IDs the user must provide
  - `'user-or-llm'` — for everything else (search queries, content, filters, IDs that could come from other blocks)
- [ ] Every param has a `description` that explains what it does
- [ ] No param is named `timeout`, `proxyUrl`, or `method` unless it means exactly what the shared
      transport means — `apps/sim/tools/request-transport.ts` reads all three off `params`
      (`:191`, `:198`, `:167`), and `timeout` is milliseconds. See **Reserved Parameter Names** in
      `.agents/skills/add-tools/SKILL.md`

### Request
- [ ] URL matches the API endpoint exactly (correct base URL, path segments, path params)
- [ ] HTTP method matches the API spec (GET, POST, PUT, PATCH, DELETE)
- [ ] Headers include correct auth pattern:
  - OAuth: `Authorization: Bearer ${params.accessToken}`
  - API Key: correct header name and format per the service's docs
- [ ] `Content-Type` header is set for POST/PUT/PATCH requests
- [ ] Body sends all required fields and only includes optional fields when provided
- [ ] For GET requests with query params: URL is constructed correctly with query string
- [ ] Every param interpolated into a URL path goes through a helper from `apps/sim/tools/url-path.ts`
      (`safeUrlPathSegment` for an opaque id, `safeUrlPath` for a documented slash-delimited path,
      `safeEncodedUrlPathSegment` for a single value that may contain `/`) — never a bare
      `` `${params.id.trim()}` `` and never a bare `encodeURIComponent`. See **Path Parameters:
      Reject Traversal, Never Just Encode** in `.agents/skills/add-tools/SKILL.md` for why encoding
      is insufficient and why `params.id?.trim()` throws a raw `TypeError` on a numeric id

### Response / transformResponse
- [ ] Correctly parses the API response (`await response.json()`)
- [ ] Extracts the right fields from the response structure (e.g., `data.data` vs `data` vs `data.results`)
- [ ] All nullable fields use `?? null`
- [ ] All optional arrays use `?? []`
- [ ] Error cases are handled: checks for missing/empty data and returns meaningful error
- [ ] Does NOT do raw JSON dumps — extracts meaningful, individual fields
- [ ] Every extracted field is backed by official docs or live-verified sample payloads

### Outputs
- [ ] All output fields match what the API actually returns
- [ ] No fields are missing that the API provides and users would commonly need
- [ ] No phantom fields defined that the API doesn't return
- [ ] `optional: true` is set on fields that may not exist in all responses
- [ ] When using `type: 'json'` and the shape is known, `properties` defines the inner fields (tool outputs only — block outputs do not support `properties`)
- [ ] When using `type: 'array'`, `items` defines the item structure with `properties` (tool outputs only)
- [ ] Field descriptions are accurate and helpful

### Types (types.ts)
- [ ] Has param interfaces for every tool (e.g., `XCreateTweetParams`)
- [ ] Has response interfaces for every tool (extending `ToolResponse`)
- [ ] Optional params use `?` in the interface (e.g., `replyTo?: string`)
- [ ] Field names in types match actual API field names
- [ ] Shared response types are properly reused (e.g., `XTweetResponse` shared across tweet tools)

### Barrel Export (index.ts)
- [ ] Every tool is exported
- [ ] All types are re-exported (`export * from './types'`)
- [ ] No orphaned exports (tools that don't exist)

### Tool Registry (tools/registry.ts)
- [ ] Every tool is imported and registered
- [ ] Registry keys use snake_case and match tool IDs exactly
- [ ] Entries are in alphabetical order within the file

### Resolved-Secret Provenance and Model Input

For every request field, determine whether it is ordinary API input, model-visible text/structured
content, opaque model input, or a value persisted into Sim-owned durable storage.

Treat model-input provenance as opt-in. Require official documentation or an unambiguous local
execution path proving that the exact field reaches an AI model. If the evidence is ambiguous,
leave the integration unchanged; do not infer a model boundary merely from natural-language,
search, extraction, or "AI-powered" marketing terminology.

- [ ] AI-consumed text/structured fields use `request.modelInput` with `mode: 'project'` and a
      minimal exact selector; nested/JSON-string adapters preserve shape through `applyProjected`
- [ ] Ordinary external URLs, domains, resource IDs, and control fields retain normal request
      semantics unless the exact field is proven model-visible; an AI-backed provider or later model
      processing of the referenced resource is not sufficient evidence
- [ ] Serialized content proven to be sent directly to an external model is selected by
      `request.modelInput`, projected before the existing formatter parses it, and has deterministic
      formatter behavior when a whole-value placeholder is invalid for the serialized grammar
- [ ] Actual inline/raw AI-consumed bytes owned by an authenticated internal route use
      `privateProvenance` (or `mode: 'private-provenance'`), and the route validates
      `validateOpaqueModelInputProvenance` before model egress; storage keys, paths, signed URLs,
      and ordinary remote URLs are not treated as byte provenance, while tracked stored bytes are
      authorized independently at the owning model-egress boundary
- [ ] Persisted workspace-file contents are checked with the shared provenance guard only when
      their bytes or decoded content cross into a model/tool-result boundary; ordinary file APIs
      remain unchanged. Unsupported secret-bearing file paths are rejected at `file_write`
- [ ] Sim-owned durable writes and internal execution handoffs that can enter workflows/models use
      field-scoped `request.secretProvenance`; authenticated receivers validate the exact selection
      and scope, strip private metadata, and persist, import, or propagate it at the owning boundary
- [ ] Private provenance is never attached to external URLs; registered in-process operations
      preserve it through `operation.modelInput` / `operation.secretProvenance`, while proven
      model-visible external fields use request projection and other external inputs remain unchanged
- [ ] No tool performs raw secret plaintext/source substitution or serializes plaintext provenance
- [ ] No `transformResponse` or tool-local helper blanket-sanitizes ordinary third-party results;
      only execution-scoped, activated Sim provenance is projected at shared model/log boundaries
- [ ] Private headers/envelopes are produced and stripped by the shared tool executor, never
      hand-rolled or returned as functional output
- [ ] Every added provenance hook has a concrete Sim `{{...}}` resolution path and a later
      persistence/model/log crossing; there is no generic handling for arbitrary filenames,
      metadata, provider results, or API payloads
- [ ] Diagnostic projection is applied only to values carrying execution-scoped provenance;
      ordinary provider responses, filenames, URLs, and errors are unchanged
- [ ] Tests cover named `{{NAME}}` projection, unproven identical public text, nested and serialized
      shape handling, unchanged ordinary external inputs, malformed/incomplete metadata, headerless
      legacy requests, metadata stripping, and durable legacy/stale/scope cases when applicable

Treat a missing or bypassed model, durable, or internal-execution provenance boundary as
**critical**. Do not fix it with a tool-specific string replacer or by sanitizing every provider
result; repair the shared request, authenticated internal-route, persistence, or re-entry boundary
that owns the data.

## Step 4: Validate Block

### Block ↔ Tool Alignment (CRITICAL)

This is the most important validation — the block must be perfectly aligned with every tool it references.

For **each tool** in `tools.access`:
- [ ] The operation dropdown has an option whose ID matches the tool ID (or the `tools.config.tool` function correctly maps to it)
- [ ] Every **required** tool param (except `accessToken`) has a corresponding subBlock input that is:
  - Shown when that operation is selected (correct `condition`)
  - Marked as `required: true` (or conditionally required)
- [ ] Every **optional** tool param has a corresponding subBlock input (or is intentionally omitted if truly never needed)
- [ ] SubBlock `id` values are unique across the entire block — no duplicates even across different conditions
- [ ] The `tools.config.tool` function returns the correct tool ID for every possible operation value
- [ ] The `tools.config.params` function correctly maps subBlock IDs to tool param names when they differ

### SubBlocks
- [ ] Operation dropdown lists ALL tool operations available in `tools.access`
- [ ] Dropdown option labels are human-readable and descriptive
- [ ] Conditions use correct syntax:
  - Single value: `{ field: 'operation', value: 'x_create_tweet' }`
  - Multiple values (OR): `{ field: 'operation', value: ['x_create_tweet', 'x_delete_tweet'] }`
  - Negation: `{ field: 'operation', value: 'delete', not: true }`
  - Compound: `{ field: 'op', value: 'send', and: { field: 'type', value: 'dm' } }`
- [ ] Condition arrays include ALL operations that use that field — none missing
- [ ] `dependsOn` is set for fields that need other values (selectors depending on credential, cascading dropdowns)
- [ ] SubBlock types match tool param types:
  - Enum/fixed options → `dropdown`
  - Free text → `short-input`
  - Long text/content → `long-input`
  - True/false → `dropdown` with Yes/No options (not `switch` unless purely UI toggle)
  - Credentials → `oauth-input` with correct `serviceId`
- [ ] Dropdown `value: () => 'default'` is set for dropdowns with a sensible default

### Advanced Mode
- [ ] Optional, rarely-used fields are set to `mode: 'advanced'`:
  - Pagination tokens / next tokens
  - Time range filters (start/end time)
  - Sort order / direction options
  - Max results / per page limits
  - Reply settings / threading options
  - Rarely used IDs (reply-to, quote-tweet, etc.)
  - Exclude filters
- [ ] **Required** fields are NEVER set to `mode: 'advanced'`
- [ ] Fields that users fill in most of the time are NOT set to `mode: 'advanced'`

### WandConfig
- [ ] Timestamp fields have `wandConfig` with `generationType: 'timestamp'`
- [ ] Comma-separated list fields have `wandConfig` with a descriptive prompt
- [ ] Complex filter/query fields have `wandConfig` with format examples in the prompt
- [ ] All `wandConfig` prompts end with "Return ONLY the [format] - no explanations, no extra text."
- [ ] `wandConfig.placeholder` describes what to type in natural language

### Tools Config
- [ ] `tools.access` lists **every** tool ID the block can use — none missing
- [ ] `tools.config.tool` returns the correct tool ID for each operation
- [ ] Type coercions are in `tools.config.params` (runs at execution time), NOT in `tools.config.tool` (runs at serialization time before variable resolution)
- [ ] `tools.config.params` handles:
  - `Number()` conversion for numeric params that come as strings from inputs
  - `Boolean` / string-to-boolean conversion for toggle params
  - Empty string → `undefined` conversion for optional dropdown values
  - Any subBlock ID → tool param name remapping
- [ ] No `Number()`, `JSON.parse()`, or other coercions in `tools.config.tool` — these would destroy dynamic references like `<Block.output>`

### Block Outputs
- [ ] Outputs cover the key fields returned by ALL tools (not just one operation)
- [ ] Output types are correct (`'string'`, `'number'`, `'boolean'`, `'json'`)
- [ ] `type: 'json'` outputs describe inner fields in the description string: `'User profile (id, name, username, bio)'` or `'[{address, status, type}]'` for arrays
- [ ] **Do NOT add a `properties: {...}` field on block outputs.** Block-level `OutputFieldDefinition` (from `@sim/workflow-types/blocks`) only accepts `{ type, description?, condition?, hiddenFromDisplay? }`. Nested `properties` is a tool-level construct (`OutputProperty`) — adding it to a block output will fail TypeScript at build time
- [ ] No opaque `type: 'json'` with vague descriptions like `'Response data'`
- [ ] Outputs that only appear for certain operations use `condition` if supported, or document which operations return them

### Block Metadata
- [ ] `type` is snake_case (e.g., `'x'`, `'cloudflare'`)
- [ ] `name` is human-readable (e.g., `'X'`, `'Cloudflare'`)
- [ ] `description` is a concise one-liner
- [ ] `longDescription` provides detail for docs
- [ ] `docsLink` points to `'https://docs.sim.ai/integrations/{service}'`
- [ ] `category` is `'tools'`
- [ ] `bgColor` uses the service's brand color hex
- [ ] `icon` references the correct icon component from `@/components/icons`
- [ ] `authMode` is set correctly (`AuthMode.OAuth` or `AuthMode.ApiKey`)
- [ ] Block + meta are registered in `blocks/registry-maps.ts` (`BLOCK_REGISTRY` / `BLOCK_META_REGISTRY`) alphabetically

### BlockMeta
- [ ] `{Service}BlockMeta` is exported in the same file as the block
- [ ] Has at least 7 templates, each with `icon`, `title`, `prompt`, `modules`, `category`, and `tags`
- [ ] Prompts describe concrete use cases, not generic descriptions of what the service does
- [ ] `alsoIntegrations` is set on any template whose prompt references another service
- [ ] `skills` present (3–5 mainstream, 2–3 niche), each grounded in `tools.access` — flag any skill implying an unsupported action
- [ ] **Each skill is real, not hallucinated** — web-search and confirm it maps to a popular use case attested online (vendor use-case pages, official docs describing the workflow, reputable "top automations" articles); rewrite/remove any you cannot source
- [ ] Each skill has a kebab-case `name` (≤64 chars, unique), a one-line `description`, and markdown `content` with `# Title` + `## Steps` + an output/guidance section

### Block Inputs
- [ ] `inputs` section lists all subBlock params that the block accepts
- [ ] Input types match the subBlock types
- [ ] When using `canonicalParamId`, inputs list the canonical ID (not the raw subBlock IDs)

## Step 5: Validate OAuth Scopes (if OAuth service)

Scopes are centralized — the single source of truth is `OAUTH_PROVIDERS` in `lib/oauth/oauth.ts`.

- [ ] Scopes defined in `lib/oauth/oauth.ts` under `OAUTH_PROVIDERS[provider].services[service].scopes`
- [ ] `auth.ts` uses `getCanonicalScopesForProvider(providerId)` — NOT a hardcoded array
- [ ] Block `requiredScopes` uses `getScopesForService(serviceId)` — NOT a hardcoded array
- [ ] No hardcoded scope arrays in `auth.ts` or block files (should all use utility functions)
- [ ] Each scope has a human-readable description in `SCOPE_DESCRIPTIONS` within `lib/oauth/utils.ts`
- [ ] No excess scopes that aren't needed by any tool

## Step 6: Validate Deployment Availability (if OAuth service)

The deployment UI and setup CLI do not infer OAuth client fields from scopes. They resolve the
block's generated `oauthServiceId` through the shared deployment capability catalog.

- [ ] The visible integration block has exactly one distinct `oauth-input.serviceId`
- [ ] `resolveOAuthClientCapabilityId(serviceId)` returns the intended provider capability
- [ ] The resolved provider exists in `OAUTH_CLIENT_CAPABILITIES`
- [ ] Every field listed by that capability exists in `apps/sim/lib/core/config/env.ts`
- [ ] Every capability field has the correct `text` or `secret` entry in `OAUTH_CLIENT_SETUP_FIELDS`; no CLI naming heuristic is required
- [ ] Shared Google/Microsoft service IDs resolve to their provider capability rather than duplicate entries
- [ ] `npx sim-setup add integration <capabilityId>` is the command emitted by availability; the CLI has only the exhaustive input-mode projection, not a second runtime provider definition
- [ ] If the canonical OAuth service declares `serviceAccountProviderId`,
      the generated `SERVICE_ACCOUNT_PROVIDER_BY_OAUTH_SERVICE_ID[serviceId]` has the same provider ID
- [ ] The service-account `deploymentRequirement` matches how that credential actually works:
      omitted for an independent path, `'oauth-client'` when it needs the OAuth client fields, or
      `'preview-gated'` when controlled by a preview block

Treat a missing capability as **critical**: runtime availability intentionally throws instead of
silently exposing an unusable integration.

## Step 7: Validate Pagination Consistency

If any tools support pagination:
- [ ] Pagination param names match the API docs (e.g., `pagination_token` vs `next_token` vs `cursor`)
- [ ] Different API endpoints that use different pagination param names have separate subBlocks in the block
- [ ] Pagination response fields (`nextToken`, `cursor`, etc.) are included in tool outputs
- [ ] Pagination subBlocks are set to `mode: 'advanced'`

## Step 8: Validate Memory Load Safety

If any tool lists, searches, exports, imports, downloads, uploads, paginates, batches, transforms arrays, or reads file/HTTP bodies, read `.agents/skills/memory-load-check/SKILL.md` and apply it to the integration.

- [ ] List/search tools expose API limits and do not auto-fetch every page into memory
- [ ] Transform logic does not build unbounded arrays, maps, sets, or `Promise.all` fan-outs
- [ ] File and HTTP body reads use explicit byte caps or existing stream-limit helpers
- [ ] Large result payloads are summarized, paginated, referenced, or capped rather than raw-dumped
- [ ] Pagination and download tests cover caps, early stop behavior, or partial-result preservation when relevant

## Step 9: Validate Path-Traversal Safety

If any tool interpolates a param into a URL path, the integration needs a path-safety suite. Design it
as follows — the naive shape does not work, and looks like it does.

**Where these references live.** The shared harness (`apps/sim/tools/__tests__/path-safety.ts`), the
per-service `path_safety.test.ts` suites, and every `url-path.ts` helper except `safeUrlPathSegment`
arrive with the path-safety sweep. References below name **module and symbol** rather than a line,
because those files are still being rebased and any line number would be stale on arrival.

**Why the naive harness is worthless.** A suite that fuzzes every param at once and wraps the build in
`try { ... } catch { return }` reports green on completely unguarded parameters: the first *guarded*
sibling throws, the case is skipped, and every unguarded sibling is never exercised. Whole tools drop
out of coverage the same way, and an aggregate count cannot detect it, because a case that never
existed cannot fail. `x_manage_block.targetUserId` and `okta_remove_user_from_group.userId` were both
fully unguarded while passing every vector a suite of that shape threw at them.

A sound suite has five properties:

1. **Enumerate (tool, param) pairs, fuzz one at a time.** Discover pairs by probing — build the URL
   with a sentinel in one param and check whether it lands in `pathname` — and hold every sibling at a
   safe value. Give *other* number params a real number so a sibling's own validation cannot abort the
   build. Reference: `discoverPathParams` in `apps/sim/tools/__tests__/path-safety.ts`.
2. **Assert rejection, not path shape.** A shape assertion (origin + segment count + unchanged
   segments) catches only a minority of the vectors: `%2F` is never decoded back into a separator, and
   a trailing bare `.` collapses to the parent with the segment count intact. Add an explicit
   assertion that the build throws **and that the message names the parameter** — matched on whole
   tokens, never `new RegExp(paramName)`, which is the substring trap recorded below (`"projectId
   cannot have leading whitespace"` would satisfy a check for `id`). Capture the message and assert
   it; do not use `toThrow(string)`, which is also a substring match:

   ```typescript
   let message = ''
   try {
     build(param, '..')
   } catch (error) {
     message = getErrorMessage(error, 'unknown error')
   }
   expect(message, `${param} accepted ".."`).not.toBe('')
   expect(namesParam(message, param), `error did not name ${param}: ${message}`).toBe(true)
   ``` Reference: the rejects-by-name assertions in `itResistsTraversal`.
3. **Probe conditional branches.** A param that only appears on one branch of a conditional URL builder
   is invisible to a single all-params probe. Harvest the string literals the builder compares against
   and re-probe under each — in **pairs** as well as singly, since a param reachable only when two
   siblings hold specific values is invisible to one-at-a-time probing — **and** probe the presence
   branches, the shape taken when an optional param is *absent*.
4. **Assert the skipped and unbuildable sets are empty.** Record every failed baseline build with its
   reason and assert the ledger against an explicit, justified allowlist, plus a second assertion that
   no URL-building tool sits outside the suite unaccounted for. `discoverPathParams` returns
   `unbuildable`, `undiscoverable`, and `withoutPathParams` from a single sweep for exactly this. This is the check that surfaced a
   tool missing from an entire suite.
5. **Pin the legitimate values too.** `..foo`, `foo..`, `v1.2.3`, and a UUID must pass through
   unaltered — a guard that over-rejects is its own bug.

### Never let a `catch` stand in for an assertion

**A tolerated throw must be tolerated by name**, in an explicit allowlist, with the reason recorded.
A blanket `catch { return }` converts every case it covers from *tolerated* to *untested*.

Keep the line that makes this usable: tolerating a failed **probe** during discovery is legitimate —
probing a guarded param is *meant* to throw. Tolerating a throw inside an **assertion** is the bug.

This was by far the most-repeated defect of the hardening effort — **nine** recorded instances, each
an assertion that could not fail. The shapes are worth knowing individually, because only the first
two look like a `catch`:

| Shape | What it hid |
|---|---|
| A sibling-masking swallow in the traversal assertion | A fully unguarded parameter stayed green — reverting `x_manage_block.targetUserId` changed nothing |
| A coverage pin enumerated through a function-only narrowing | 11 tools across four services were invisible, so `toEqual([...])` passed *because* they could not be seen |
| The `preservesWhitespace` branch swallowing a rejection | The branch whose docstring says padding must survive to the wire tolerated a refusal of it |
| The renders-inert cases swallowing any throw | Over-tightening — see below |
| A **substring** matcher behind "the error names the parameter" | `"projectId cannot have leading whitespace"` satisfied the assertion for param `id`, and `"pathological failure"` satisfied `path` — so a guard naming the **wrong** identifier passed the very check meant to catch that. Match whole tokens (or a run of adjacent tokens, so `"Invalid function name"` still names `functionName`) |
| An assertion that **guarded itself out of existence** | `if (serialized?.includes('projectId')) { expect(...) }` stopped verifying the moment a body dropped the field. Assert unconditionally |
| `describe.each` over a silently-empty derived array | The group was filtered out of existence by a rename; a floor on the *total* still passed, so a whole block of assertions vanished emitting neither tests nor failures. Pin each derived group, not their sum |
| **Fixture drift** — an assertion outliving the input it was written against | `expect(serialized).not.toContain('  my-project  ')` was written when the fixture *was* padded. A strict guard made padding throw, the fixture was unpadded, and the assertion stayed — now asserting the absence of a string that can no longer occur. It passes forever |
| **A globally-mocked dependency** the assertion reads through | `vitest.setup.ts:112` stubs `@/tools/registry` as `{ tools: {} }`, so a guard that iterates the registry sees nothing and passes over an empty set. Four real failures only reproduced once `vi.unmock('@/tools/registry')` was added (`apps/sim/blocks/blocks/github.test.ts:3`) |

Note that the last two have **different causes** from the rest, which is why auditing `catch` blocks
and filters does not find them. The first four are *a tolerance applied too broadly*; fixture drift is
*an assertion outliving its input*; the mock is *the assertion never reaching the real subject*. Check
all three.

**When an assertion couples two literals, derive one from the other instead of re-pinning it.** That
is the fix that actually removes fixture drift rather than resetting its clock — a test named "agrees"
should assert agreement, not two constants that happen to match:

```typescript
const urlProject = url.pathname.split('/projects/')[1]?.split('/')[0]
expect(serialized).toContain(`"projectId":"${urlProject}"`)
```

A matcher is the highest-leverage instance of this: a weakness in it is invisible from every suite it
powers, so give a shared matcher its own contract test (`namesParam` in
`apps/sim/tools/__tests__/path-safety.ts` has one) and verify it red by reverting to the loose form.

**The last one fails in the opposite direction from everything else here, and that is the point.**
`catch { return }` meant the origin check, the prefix check, and the inert-probe assertion never ran —
so a guard that **over-tightened**, rejecting a value it should merely have encoded, passed silently.
A path-safety suite that only catches under-guarding is half a suite.

The resolution is the shape to copy:

1. Enumerate every (tool, param) pair against every inert value.
2. **Measure** which ones legitimately throw, and establish why — do not assume.
3. Make a throw a **failure** unless the parameter is named in an explicit allowlist
   (the `strictlyValidated` option), with the justification in its TSDoc.

Measured on that PR, exactly ten pairs legitimately reject: Supabase `table` via
`validateDatabaseIdentifier` and `functionName` via `validateFunctionName`
(the Supabase suite passes them as `strictlyValidated`), correct because `abc#fragment` is a fine URL
segment but not a SQL identifier. Every other pair must build.

- [ ] A `path_safety.test.ts` exists for the service and enumerates (tool, param) pairs
- [ ] Each pair asserts a *named* rejection of the bare `.` and `..` segments
- [ ] Conditional and presence branches of every conditional URL builder are probed
- [ ] The skipped/unbuildable ledger is asserted empty against a justified allowlist
- [ ] Legitimate dot-bearing values pass through unchanged
- [ ] No assertion wraps its subject in a blanket `catch` — every tolerated throw is allowlisted by
      name with a recorded reason, and over-tightening fails the suite as loudly as under-guarding
- [ ] Shared matchers have their own contract test, verified red against the loose form
- [ ] Assertions pin exact encoded output and exact error text, never a bare `toThrow()`
- [ ] **Every new assertion was verified red before it was kept** — revert the fix, watch it fail
- [ ] **When a fixture changed, every assertion that referenced its old value was re-verified red**
- [ ] Assertions that read a globally-mocked module (`@/tools/registry`, `@/blocks/registry`, …)
      `vi.unmock` it first, or they pass over the stub

### A hardening change must not turn a failing request into a succeeding one

State it in exactly those words, and apply it to every guard you add. It is the check that caught a
class of regression the whole sweep otherwise missed — sixteen PRs' own suites, both review bots on
several passes, and the author.

Adding a guard that **trims** a path identifier looks strictly safer. It is not, when that identifier
reaches a destructive endpoint, because trimming is only neutral if the untrimmed value already
worked. Where the parameter previously went out through a bare `encodeURIComponent`, it did not:

```
box_sign_cancel_request  (apps/sim/tools/box_sign/cancel_request.ts)
  before: /2.0/sign_requests/%20%20<uuid>%20%20/cancel  -> 404, no-op
  after:  /2.0/sign_requests/<uuid>/cancel              -> cancels a real signature request

cloudflare_delete_r2_bucket  (apps/sim/tools/cloudflare/delete_r2_bucket.ts)
  before: "  prod-data  " names no bucket that can exist -> request FAILS
  after:  trimmed to "prod-data"                         -> DESTROYS the real bucket

google_bigquery_delete_dataset / _delete_table  — same shape on projectId
```

**Reason about the intersection, not the guard's contract.** "Trimming is the helper's contract at all
137 call sites" is an *average*, and it excuses the deletion above. The real question is a set
intersection: which parameters does this change *newly* normalise, **and** which of those sit on an
irreversible request (DELETE, cancel, revoke, purge, drop)? On the Cloudflare PR the answer was
exactly **one of 137** — and it took four review passes escalating P2→P2→P1→P1, with two pushbacks,
to establish it.

**The resolution: refuse the padded value on those parameters.** Not on consistency grounds — on two
facts specific to the values themselves:

1. No legitimate identifier for these providers carries surrounding whitespace (a Box Sign id is a
   UUID; a GCP project id matches `[a-z][a-z0-9-]{5,29}`; an R2 bucket name is
   `^[a-z0-9][a-z0-9-]*[a-z0-9]`), so refusing excludes nothing a caller could really mean.
2. The previous behaviour was already a clean failure, so refusing preserves it — and improves on it
   by replacing an opaque provider 404 with an error naming the parameter.

`strictUrlPathSegment` in `apps/sim/tools/url-path.ts` is `safeUrlPathSegment` with that precondition,
and `strictEncodedUrlPathSegment` is its `%2F`-preserving counterpart. Derive any body copy of the same
identifier from the same guard, so the path value and the body value share one rule rather than two.

Parameters that were **already** trimmed before your change keep plain `safeUrlPathSegment` — that is
not a change you are making, and tightening them would break callers whose stored value works today.

- [ ] Enumerated the parameters whose normalisation this change actually alters
- [ ] Intersected that set with destructive operations and checked each member individually
- [ ] Newly-trimmed identifiers on irreversible requests refuse the padded value rather than trimming it
- [ ] Already-trimmed identifiers were left alone

### Your tests can lie to you

Two ways a green suite means nothing, both hit during this effort.

#### Assert exact error text and exact encoded output — never a bare `toThrow()`

This is the **counterweight** to the rule above. "Never let a `catch` stand in for an assertion" says
*make sure it can fail*; this one says *make sure it fails for the right reason*.

A guard your suite exercises usually lives in a module someone else owns, so its behaviour changes
land underneath the suite without touching a line of it. Pinning exact strings is what converts that
into a failing test instead of a silent behaviour change. On this effort it caught three separate
upstream changes to `url-path.ts` that a `toThrow()`-only suite goes green through:

- `safeUrlPath` stopped trimming each segment, so a storage key's interior whitespace began surviving
  to the wire — caught by an **equality assertion on the encoded output**.
- Its empty-segment check narrowed from `!segment.trim()` to `!segment`, so `a/ /b` became legal while
  `a//b` stayed rejected — caught by an assertion on the **exact error text**. This one is a silent
  correctness change in *either* direction: permitting `a//b` retargets the request at a different
  object, rejecting `a/ /b` makes a real object key permanently unreachable.
- A rebase changed a guard's wording from `"cannot have"` to `"must not have leading or trailing
  whitespace"`, failing four assertions. They were **updated to the new wording, not loosened** — that
  precision is the property that caught the other two.

**`toThrow('...')` does not do this.** Vitest treats a string argument as a *substring* match, so it
is only a slightly tighter `toThrow()` and drifts for the same reason. Capture the message and assert
equality, and pin the output with `toBe`:

```typescript
expect(decodeURIComponent(url.pathname)).toBe('<the exact expected path>')

let message = ''
try {
  build(...)
} catch (error) {
  message = getErrorMessage(error, 'unknown error')
}
expect(message).toBe('<the exact message>')
```

Never relax one of these to `toThrow()`, `toThrow(string)`, or `toContain()` to make a rebase quiet —
update the expectation to the new wording instead.

#### These tests are type-checked by nothing

`apps/sim/tsconfig.json` excludes `**/*.test.ts` and `**/*.test.tsx` from `include`, and
`apps/sim/vitest.config.ts` declares no `typecheck` block — Vitest transpiles with esbuild and never
type-checks. So `bun run type-check` will pass over a harness full of type errors, and a harness that
silently narrows to `any` will still run.

To type-check one, write a temporary tsconfig that extends `apps/sim/tsconfig.json`, drops the
`**/*.test.ts` exclusion, and includes only the harness — then delete it. Do not commit it; the
exclusion exists deliberately.

#### A test that calls a function directly can pass while the wrapper does the opposite

`executeTool` wraps every `postProcess` call in a catch that logs and then restores the
pre-`postProcess` result (`apps/sim/tools/index.ts:1977` and `:2062`). For a submit-then-poll tool
that pre-`postProcess` result is the **submit** response — `success: true` with every result field
null. So a `postProcess` that throws on a timed-out or exhausted poll is reported to the user as a
successful lookup that simply found nothing, and the hosted-key cost hook, gated on
`finalResult.success` (`:1987`), bills it.

Eleven Enrow failure-path tests asserted that throwing contract by calling `postProcess` directly.
Every one passed. Production reported `success: true`. Assert through the real call path — or, where
a test must call the function directly, assert the shape the *executor* will hand back, not the one
the function raises.

## Step 10: Validate Error Handling

- [ ] `transformResponse` checks for error conditions before accessing data
- [ ] Error responses include meaningful messages (not just generic "failed")
- [ ] HTTP error status codes are handled (check `response.ok` or status codes)

## Step 11: Report and Fix

### Report Format

Group findings by severity:

**Critical** (will cause runtime errors or incorrect behavior):
- Wrong endpoint URL or HTTP method
- Missing required params or wrong `required` flag
- Incorrect response field mapping (accessing wrong path in response)
- Missing error handling that would cause crashes
- Tool ID mismatch between tool file, registry, and block `tools.access`
- OAuth scopes missing in `auth.ts` that tools need
- OAuth integration `serviceId` missing from the deployment capability catalog
- Capability references an env field absent from the runtime env schema
- Service-account metadata disagrees with the canonical OAuth service configuration
- `tools.config.tool` returning wrong tool ID for an operation
- Type coercions in `tools.config.tool` instead of `tools.config.params`
- Proven model-visible request fields bypass the shared projection or private-provenance boundary
- Opaque model input is downloaded or sent before provenance and workspace-file checks
- A Sim-owned durable sink or internal execution handoff drops encrypted provenance or breaks
  legacy headerless/`NULL` data
- A tool substitutes secret plaintext into source, leaks private metadata, or generically sanitizes
  unrelated third-party results

**Warning** (follows conventions incorrectly or has usability issues):
- Optional field not set to `mode: 'advanced'`
- Missing `wandConfig` on timestamp/complex fields
- Wrong `visibility` on params (e.g., `'hidden'` instead of `'user-or-llm'`)
- Missing `optional: true` on nullable outputs
- Opaque `type: 'json'` without property descriptions
- Missing `.trim()` on ID fields in request URLs
- Missing `?? null` on nullable response fields
- Block condition array missing an operation that uses that field
- Hardcoded scope arrays instead of using `getScopesForService()` / `getCanonicalScopesForProvider()`
- Missing scope description in `SCOPE_DESCRIPTIONS` within `lib/oauth/utils.ts`

**Suggestion** (minor improvements):
- Better description text
- Inconsistent naming across tools
- Missing `longDescription` or `docsLink`
- Pagination fields that could benefit from `wandConfig`

### Fix All Issues

After reporting, fix every **critical** and **warning** issue. Apply **suggestions** where they don't add unnecessary complexity.

### Regenerate Derived Artifacts

Several files are generated from tool and block definitions. Editing a tool or block WITHOUT regenerating them fails CI, so run these before pushing:

```bash
bun run tool-metadata:generate       # repo root — apps/sim/tools/generated/*
bun run scripts/generate-docs.ts     # docs .mdx + deployment-config/integrations.json + docs icons
bun run deployment-config:generate  # canonical OAuth registry + catalog → provider-ID facts
bun run integration-catalog:check    # registry ↔ committed deployment metadata drift
bun run docs:check                   # committed docs ↔ what the generator renders today
bun run deployment-config:check     # OAuth registry/catalog ↔ provider-ID fact drift
```

- **`tool-metadata:generate`** — required whenever a tool's `outputs`, `params`, or descriptions change. CI enforces this with `bun run tool-metadata:check`, which fails with *"Generated tool metadata is stale"*. This is the easiest gate to miss, because nothing in the tool file hints that a generated artifact mirrors it.
- **`generate-docs`** — required whenever block metadata changes (`bgColor`, `name`, `description`, operations, outputs). Regenerates the integration `.mdx`, `packages/deployment-config/src/integrations.json`, and the docs copy of `components/icons.tsx`.
- **`deployment-config:generate`** — required for OAuth or service-account changes. Regenerates provider-ID facts from the canonical OAuth registry and integration catalog; special deployment requirements remain handwritten policy.
- **`integration-catalog:check`** — loads the executable block registry, derives visible integration
  deployment fields, and compares them with the committed catalog. It catches missing/unexpected
  entries and stale auth/service IDs without loading the executable registry in client code.
- **`docs:check`** — check mode of `generate-docs.ts`: renders every generated docs artifact in
  memory and fails listing any committed file that differs. Runs in CI via `check:audits`.

**Always diff the regen output before committing — but commit all of it.** These generators rewrite
every file they own, so they also true up drift that accumulated on the base branch (pages whose
source changed without a regen). That catch-up is correct output, not a regression: `docs:check`
fails CI on any page left stale, so reverting swept-in hunks with `git checkout --` reintroduces the
failure. Review the diff to confirm each hunk is explained by a real source change (yours or an
upstream PR that skipped regeneration), and investigate anything that looks like content loss — a
page losing a section usually means its source block moved or a generator input broke, not that the
hunk should be reverted.

If an icon changed, `apps/sim/components/icons.tsx` is the source of truth and `apps/docs/components/icons.tsx` is its generated mirror — they must end up byte-identical for that component.

### Validation Output

After fixing, confirm:
1. `bun run lint` passes with no fixes needed
2. TypeScript compiles clean (no type errors) — check the error list is empty for the files you touched; pre-existing unrelated errors in a worktree usually mean workspace packages resolve to the main checkout
3. The integration's tests pass, and any test you added actually fails without its fix (revert it once and watch it go red)
4. Derived artifacts regenerated and their diffs reviewed (see above)
5. `bun run integration-catalog:check` passes
6. `bun run docs:check` passes
7. For OAuth or service-account changes, `bun run deployment-config:check` passes
8. For OAuth or service-account changes, `bun run --cwd apps/sim test lib/integrations/availability.server.test.ts` passes
9. Re-read all modified files to verify fixes are correct
10. Any remaining unknown response schemas were explicitly reported to the user instead of guessed

## Checklist Summary

- [ ] Read ALL tool files, block, types, index, and registries
- [ ] Pulled and read official API documentation
- [ ] Validated every tool's ID, params, request, response, outputs, and types against API docs
- [ ] Validated block ↔ tool alignment (every tool param has a subBlock, every condition is correct)
- [ ] Validated advanced mode on optional/rarely-used fields
- [ ] Validated wandConfig on timestamps and complex inputs
- [ ] Validated tools.config mapping, tool selector, and type coercions
- [ ] Validated block outputs match what tools return, with typed JSON where possible
- [ ] Validated OAuth scopes use centralized utilities (getScopesForService, getCanonicalScopesForProvider) — no hardcoded arrays
- [ ] Validated scope descriptions exist in `SCOPE_DESCRIPTIONS` within `lib/oauth/utils.ts` for all scopes
- [ ] Validated OAuth `serviceId` resolves to the intended `OAUTH_CLIENT_CAPABILITIES` entry and all capability fields exist in the env schema
- [ ] Validated service-account projection and deployment requirement against the canonical OAuth service config
- [ ] Regenerated deployment config when block/OAuth metadata changed and ran both catalog checks
- [ ] Validated pagination consistency across tools and block
- [ ] Validated memory load safety using `.agents/skills/memory-load-check/SKILL.md` when tools list/search/download/import/export/batch data
- [ ] Validated path-traversal safety: url-path helpers at every path interpolation, and a
      `path_safety.test.ts` that enumerates (tool, param) pairs, asserts named rejection, probes
      conditional and presence branches, and asserts an empty skip ledger
- [ ] Validated no param collides with a transport-reserved name (`timeout`, `proxyUrl`, `method`)
- [ ] Confirmed no hardening change turns a failing request into a succeeding one — newly-normalised
      parameters intersected with destructive operations, each checked individually
- [ ] Confirmed failure-path tests assert through the real call path, not a direct call the executor
      wraps differently
- [ ] Validated error handling (error checks, meaningful messages)
- [ ] Validated registry entries (tools and block, alphabetical, correct imports)
- [ ] Validated model-visible/opaque inputs and Sim-durable/internal-execution provenance at their
      owning boundaries
- [ ] Confirmed legacy persisted data keeps working and tracked invalid provenance fails closed
- [ ] Confirmed ordinary third-party results remain unchanged absent activated Sim provenance
- [ ] Validated `{Service}BlockMeta` exported with at least 7 templates
- [ ] Reported all issues grouped by severity
- [ ] Fixed all critical and warning issues
- [ ] Ran `bun run tool-metadata:generate` if any tool outputs/params changed, and confirmed `bun run tool-metadata:check` passes
- [ ] Ran `bun run generate-docs` if any block metadata changed, and committed the full generated diff — including stale-page catch-up for other integrations (`bun run docs:check` fails CI on reverted generator output)
- [ ] Ran `bun run lint` after fixes
- [ ] Verified TypeScript compiles clean
- [ ] Verified added tests fail without their fix
