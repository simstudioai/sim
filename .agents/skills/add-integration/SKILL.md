---
name: add-integration
description: Add a complete Sim integration from API docs, covering tools, block, icon, optional triggers, registrations, resolved-secret/model-input safety, and integration conventions. Use when introducing a new service under `apps/sim/tools`, `apps/sim/blocks`, and `apps/sim/triggers`.
argument-hint: <service-name> [api-docs-url]
---

# Add Integration Skill

You are an expert at adding complete integrations to Sim. This skill orchestrates the full process of adding a new service integration.

## Overview

Adding an integration involves these steps in order:
1. **Research** - Read the service's API documentation
2. **Create Tools** - Build tool configurations for each API operation
3. **Create Block** - Build the block UI configuration
4. **Add Icon** - Add the service's brand icon
5. **Create Triggers** (optional) - If the service supports webhooks
6. **Register** - Register tools, block, and triggers in their registries
7. **Configure Deployment Availability** - Wire OAuth client and service-account metadata
8. **Generate and Validate the Catalog** - Regenerate docs/catalog artifacts and run drift checks

## Step 1: Research the API

Before writing any code:
1. Use Context7 to find official documentation: `mcp__context7__resolve-library-id`, then fetch with `mcp__context7__query-docs`
2. Or use WebFetch to read API docs directly
3. Identify:
   - Authentication method (OAuth, API Key, both)
   - Available operations (CRUD, search, etc.)
   - Required vs optional parameters
   - Response structures

### Hard Rule: No Guessed Response Schemas

If the official docs do not clearly show the response JSON shape for an endpoint, you MUST stop and tell the user exactly which outputs are unknown.

- Do NOT guess response field names
- Do NOT infer nested JSON paths from related endpoints
- Do NOT invent output properties just because they seem likely
- Do NOT implement `transformResponse` against unverified payload shapes

If response schemas are missing or incomplete, do one of the following before proceeding:
1. Ask the user for sample responses
2. Ask the user for test credentials so you can verify the live payload
3. Reduce the scope to only endpoints whose response shapes are documented
4. Leave the tool unimplemented and explicitly report why

## Step 2: Create Tools

### Directory Structure
```
apps/sim/tools/{service}/
├── index.ts          # Barrel exports
├── types.ts          # TypeScript interfaces
├── {action1}.ts      # Tool for action 1
├── {action2}.ts      # Tool for action 2
└── ...
```

### Key Patterns

Choose the tool boundary before writing the declaration:

- Use `InternalToolConfig.operation` for same-process Sim/provider work. Put the handler under
  `apps/sim/lib/internal/{service}/execute-tool.ts` and register every ID in
  `apps/sim/lib/internal/tool-operations/registry.server.ts`.
- Use `ToolConfig.request` only for an absolute external HTTP(S) provider endpoint.

Never point a tool at `/api/...`, construct an absolute URL back to Sim, declare
`request.internal`, add a `directExecution` property (it fails `bun run check:tool-request-boundary`), or add an API route merely to reuse code, normalize files, or authorize
resources. A real external/browser route and an in-process tool may share the same operation, but
neither calls the other. Follow the full transport and handler rules in the `add-tools` skill.

**types.ts:**
```typescript
import type { ToolResponse } from '@/tools/types'

export interface {Service}{Action}Params {
  accessToken: string      // For OAuth services
  // OR
  apiKey: string          // For API key services

  requiredParam: string
  optionalParam?: string
}

export interface {Service}Response extends ToolResponse {
  output: {
    // Define output structure
  }
}
```

**Tool file pattern:** an external provider API uses `ToolConfig` with `request` (absolute `https://` URL, headers, body, `transformResponse`); same-process Sim work uses `InternalToolConfig` with `operation`. Both full templates, param visibility rules, and output typing live in `.agents/skills/add-tools/SKILL.md` — read it before writing the first tool.

### Critical Rules
- `visibility: 'hidden'` for OAuth tokens
- `visibility: 'user-only'` for API keys and user credentials
- `visibility: 'user-or-llm'` for operation parameters
- Always use `?? null` for nullable API response fields
- Always use `?? []` for optional array fields
- Set `optional: true` for outputs that may not exist
- Never output raw JSON dumps - extract meaningful fields
- When using `type: 'json'` and you know the object shape, define `properties` with the inner fields so downstream consumers know the structure. Only use bare `type: 'json'` when the shape is truly dynamic

### Resolved Secrets at Model and Persistence Boundaries

Classify every request field (ordinary provider input / AI-consumed text / opaque model bytes /
Sim-durable storage) before implementing the tool and apply the shared projection or provenance
mechanism only where a concrete Sim `{{...}}` resolution path reaches a later model or log boundary.
Full rules and the required tests are in `.agents/skills/add-tools/SKILL.md` → "Resolved Secrets and
Provenance Boundaries".

## Step 3: Create Block

### File Location
`apps/sim/blocks/blocks/{service}.ts`

Follow `.agents/skills/add-block/SKILL.md` for the block structure, subBlock types,
`condition`/`dependsOn`/`required`/`mode` syntax, outputs, `canvasPresentation` sentences, and the
`{Service}BlockMeta` export (minimum 7 templates, plus `url` and `skills`). Every block declares
`canvasPresentation`; `bun run apps/sim/scripts/check-canvas-sentences.ts --block={service}` must
pass (CI runs `check:canvas-sentences --require-coverage`).

Two rules that are easy to get wrong when copying from existing blocks:

- Every remote `selectorKey` must use the unified server selector path. Apply the `add-selector` skill:
  add browser-safe metadata to `apps/sim/lib/selectors/manifest.ts`, reuse or extract a server-only
  provider listing primitive, and add a credential- and destination-bound server attachment. Do not
  add code under `hooks/selectors/providers`, a provider-specific query key, browser token acquisition,
  or a selector-only API route. The shared context builder sends only active `dependsOn` values and
  preserves exact `{{KEY}}` environment references for server-side resolution.
- A `canonicalParamId` is a third name that neither member of a basic/advanced pair uses as its `id`
  (e.g. `channelSelector` + `channelId` → `canonicalParamId: 'channel'`). It is the only key that
  survives serialization, so `inputs` and `tools.config.params` reference the canonical id, never the
  subblock ids. It is unique block-wide, and every member of a group shares the same `required` value.

## Step 4: Add Icon

### File Location
`apps/sim/components/icons.tsx`

### Pattern
```typescript
export function {Service}Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* SVG paths from user-provided SVG */}
    </svg>
  )
}
```

### Getting Icons
**Do not search for icons yourself.** At the end of implementation, ask the user to paste the service's SVG (usually on its brand/press kit page).

Once the user provides the SVG:
1. Extract the SVG paths/content
2. Create a React component that spreads props
3. Ensure viewBox is preserved from the original SVG

### Theme-safety (bare rendering) — REQUIRED

The icon renders both inside its colored `bgColor` tile AND "bare" (no tile) on a
neutral page — e.g. the home **Suggested actions** list — in both light and dark
mode. A monochrome logo whose paths hardcode a single near-white or near-black
fill is invisible bare on the matching background (white-on-white in light mode,
black-on-black in dark mode).

Rules when adding the SVG:

- **Monochrome logos** (a single white or black mark): draw the shape with
  `fill='currentColor'`, not `fill='#fff'` / `fill='#000000'`. It then inherits
  white inside dark tiles, near-black inside light tiles (via
  `getTileIconColorClass`), and the theme-aware `var(--text-icon)` bare — legible
  everywhere. Do NOT set `iconColor` for these.
- **Multi-color brand logos** (their own vivid fills): keep the hardcoded fills.
  They read on any background. Only set `iconColor` (a vivid brand hex, never a
  near-black/near-white tile color) if the bare icon should adopt a brand tint.
- A large white shape with a tiny vivid accent (e.g. a logo where the body is the
  white negative space) still vanishes bare — convert the body to `currentColor`.

Verify with `bun run check:bare-icons` (also runs in CI). It flags purely
monochrome hazards; for partial-accent logos, eyeball the suggested-actions list
in both light and dark mode.

## Step 5: Create Triggers (Optional)

If the service supports webhooks or needs polling, follow `.agents/skills/add-trigger/SKILL.md`
(directory layout, `buildTriggerSubBlocks`, provider handler, polling handler); then wire
`triggers.enabled` / `triggers.available` into the block and spread each trigger's
`getTrigger(id).subBlocks` after the tool subBlocks.

## Step 6: Register Everything

### Tools Registry (`apps/sim/tools/registry.ts`)

```typescript
// Add import (alphabetically)
import {
  {service}Action1Tool,
  {service}Action2Tool,
} from '@/tools/{service}'

// Add to tools object (alphabetically)
export const tools: Record<string, ToolConfig> = {
  // ... existing tools ...
  {service}_action1: {service}Action1Tool,
  {service}_action2: {service}Action2Tool,
}
```

Then regenerate the generated tool metadata and commit it:

```bash
bun run tool-metadata:generate
```

Client code reads `params`/`outputs` from these artifacts rather than importing
the registry, so a tool you add, change or remove is invisible to the UI until they are regenerated,
and CI fails on stale ones. See `.agents/skills/tool-registry-boundary/SKILL.md`.

### Block Registry (`apps/sim/blocks/registry-maps.ts`)

The data maps (`BLOCK_REGISTRY` + `BLOCK_META_REGISTRY`) live in `registry-maps.ts`; `registry.ts` holds only the accessor functions. Add the import and an entry to each map alphabetically:

```typescript
// Add import (alphabetically)
import { {Service}Block, {Service}BlockMeta } from '@/blocks/blocks/{service}'

// Add to the config map (alphabetically)
export const BLOCK_REGISTRY: Record<string, BlockConfig> = {
  // ... existing blocks ...
  {service}: {Service}Block,
}

// Add to the catalog-meta map (alphabetically)
export const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {
  // ... existing metas ...
  {service}: {Service}BlockMeta,
}
```

### Trigger Registry (`apps/sim/triggers/registry.ts`) - If triggers exist

```typescript
// Add import (alphabetically)
import {
  {service}EventATrigger,
  {service}EventBTrigger,
  {service}WebhookTrigger,
} from '@/triggers/{service}'

// Add to TRIGGER_REGISTRY (alphabetically)
export const TRIGGER_REGISTRY: TriggerRegistry = {
  // ... existing triggers ...
  {service}_event_a: {service}EventATrigger,
  {service}_event_b: {service}EventBTrigger,
  {service}_webhook: {service}WebhookTrigger,
}
```

## Step 7: Configure Deployment Availability

Do this for every visible OAuth integration. API-key and unauthenticated integrations do not need
an OAuth client capability.

The block's `oauth-input.serviceId` is the canonical link between the generated integration catalog,
the OAuth service configuration, deployment availability, and the setup CLI.

1. Ensure the block has exactly one distinct OAuth `serviceId` and that it matches the canonical
   service entry in `apps/sim/lib/oauth/oauth.ts`.
2. Confirm `resolveOAuthClientCapabilityId(serviceId)` resolves to the intended provider entry in
   `OAUTH_CLIENT_CAPABILITIES` in `packages/deployment-config/src/env-capabilities.ts`. Google and
   Microsoft service IDs deliberately share provider-level capabilities.
3. For a new OAuth provider, add the required client fields to `OAUTH_CLIENT_CAPABILITIES`, add
   every referenced field to the env schema in `apps/sim/lib/core/config/env.ts`, and add the
   matching `text` or `secret` entries to `OAUTH_CLIENT_SETUP_FIELDS` in
   `packages/sim-setup/src/capability-config.ts`. Do not create integration-specific setup logic or
   infer secret fields from naming; the CLI mapping is exhaustively checked against the runtime
   fields.
4. If the canonical OAuth service has `serviceAccountProviderId`, run
   `bun run deployment-config:generate` to refresh
   `packages/deployment-config/src/service-account-providers.generated.ts`; never hand-edit the
   generated provider-ID map. In `packages/deployment-config/src/service-account-metadata.ts`, use:
   - no `deploymentRequirement` when the service-account path works independently of OAuth client fields;
   - `'oauth-client'` when it requires the same deployment OAuth client fields;
   - `'preview-gated'` when availability is controlled by the service-account preview block.

Never add a permissive fallback for missing capability metadata. A visible OAuth integration without
a resolvable capability must fail validation.

## Step 8: Generate and Validate the Catalog

Run the documentation generator:
```bash
bun run scripts/generate-docs.ts
bun run deployment-config:generate
bun run integration-catalog:check
bun run deployment-config:check
bun run docs:check
```

This creates `apps/docs/content/docs/integrations/{service}.mdx` — one page per service carrying the block's Actions and, if it has one, its Triggers section. Never hand-edit generated pages; the only editable region is the `{/* MANUAL-CONTENT */}` block (see `scripts/README.md`).

The docs generator refreshes `packages/deployment-config/src/integrations.json`, and the deployment
config generator projects service-account provider IDs from that catalog plus the canonical OAuth
registry. The checks compare both committed projections with their sources. Review the generated
diff and keep only intentional changes.

## V2 Integration Pattern

If creating V2 versions (API-aligned outputs):

1. **V2 Tools** - Add `_v2` suffix, version `2.0.0`, flat outputs
2. **V2 Block** - Add `_v2` type, use `createVersionedToolSelector`
3. **V1 Block** - Add `(Legacy)` to name, set `hideFromToolbar: true`, and add
   `sunset: { status: 'legacy', replacedBy: '{service}_v2' }` — `check-block-registry`
   fails a legacy block with no `replacedBy`, and the amber legacy badge plus its
   click-to-upgrade action read from that field.

   **Only add `replacedBy` once the target is GA.** The same check also fails when
   the target is unregistered, itself sunset, or still `preview: true`. If v2 is
   preview-gated, leave v1 alone until GA and drop `preview` in the *same commit*
   that adds the sunset — splitting them breaks the build in between.
4. **Registry** - Register both versions

```typescript
// In registry
{service}: {Service}Block,        // V1 (legacy, hidden)
{service}_v2: {Service}V2Block,   // V2 (visible)
```

## Complete Checklist

### Tools
- [ ] Created `tools/{service}/` directory
- [ ] Created `types.ts` with all interfaces
- [ ] Created tool file for each operation
- [ ] Chose exactly one boundary per tool: registered `InternalToolConfig.operation` or absolute
      external HTTP(S) `ToolConfig.request`
- [ ] No tool points to `/api/...`, constructs a URL back to Sim, declares `request.internal` or a
      `directExecution` property (fails `bun run check:tool-request-boundary`), or has an HTTP fallback for an in-process operation
- [ ] All params have correct visibility
- [ ] All nullable fields use `?? null`
- [ ] All optional outputs have `optional: true`
- [ ] Created `index.ts` barrel export
- [ ] Registered all tools in `tools/registry.ts`
- [ ] Ran `bun run tool-metadata:generate` and committed the regenerated artifacts
- [ ] Classified every model-visible, opaque, Sim-durable, and internal-execution request field
- [ ] Added shared model-input projection or private provenance only where required; ordinary
      external resource locators and control inputs retain their request semantics
- [ ] Confirmed ordinary third-party tool results are not generically sanitized
- [ ] Added provenance compatibility and fail-closed boundary tests where applicable
- [ ] `bun run check:tool-request-boundary` passes
- [ ] Internal-operation registry completeness test passes for every operation-backed tool

### Block
- [ ] Created `blocks/blocks/{service}.ts`
- [ ] Set `integrationType` to the correct `IntegrationType` enum value
- [ ] Set `tags` array with all applicable `IntegrationTag` values
- [ ] Defined operation dropdown with all operations
- [ ] Added credential field with `requiredScopes: getScopesForService('{service}')`
- [ ] Added conditional fields per operation
- [ ] Set up dependsOn for cascading selectors
- [ ] Every remote `selectorKey` exists in the shared manifest and has one server attachment with
      trusted credential provider binding and a fixed, credential-bound, or explicitly reviewed
      user-controlled destination policy
- [ ] No selector provider logic, credential resolution, or provider route call runs in the browser
- [ ] Configured tools.access with all tool IDs
- [ ] Configured tools.config.tool selector
- [ ] Defined outputs matching tool outputs
- [ ] Registered block + meta in `blocks/registry-maps.ts` (`BLOCK_REGISTRY` / `BLOCK_META_REGISTRY`)
- [ ] If triggers: set `triggers.enabled` and `triggers.available`
- [ ] If triggers: spread trigger subBlocks with `getTrigger()`
- [ ] Exported `{Service}BlockMeta` with at least 7 templates
- [ ] `canvasPresentation.sentences` covers every operation; `bun run apps/sim/scripts/check-canvas-sentences.ts --block={service}` passes
- [ ] `{Service}BlockMeta` also sets `url` (verified external homepage) and `skills` (grounded in `tools.access`, sourced from real use cases) — see add-block → BlockMeta

### OAuth Scopes (if OAuth service)
- [ ] Defined scopes in `lib/oauth/oauth.ts` under `OAUTH_PROVIDERS`
- [ ] Added scope descriptions in `SCOPE_DESCRIPTIONS` within `lib/oauth/utils.ts`
- [ ] Used `getCanonicalScopesForProvider()` in `auth.ts` (never hardcode)
- [ ] Used `getScopesForService()` in block `requiredScopes` (never hardcode)

### Deployment Availability (if OAuth service)
- [ ] Block declares exactly one distinct `oauth-input.serviceId`
- [ ] `resolveOAuthClientCapabilityId(serviceId)` resolves to the intended `OAUTH_CLIENT_CAPABILITIES` entry
- [ ] Every new OAuth capability field exists in `apps/sim/lib/core/config/env.ts`
- [ ] Runtime OAuth fields live in `OAUTH_CLIENT_CAPABILITIES`; matching CLI input modes live in the exhaustively checked `OAUTH_CLIENT_SETUP_FIELDS`
- [ ] If `serviceAccountProviderId` is configured, `SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID` has the matching projection and deployment requirement

### Icon
- [ ] Asked user to provide SVG
- [ ] Added icon to `components/icons.tsx`
- [ ] Icon spreads props correctly
- [ ] Monochrome marks use `fill='currentColor'` (not hardcoded white/black) so the icon renders bare in light AND dark mode — verified with `bun run check:bare-icons`

### Triggers (if service supports webhooks)
- [ ] Created `triggers/{service}/` directory
- [ ] Created `utils.ts` with options, instructions, and extra fields helpers
- [ ] Primary trigger uses `includeDropdown: true`
- [ ] Secondary triggers do NOT have `includeDropdown`
- [ ] All triggers use `buildTriggerSubBlocks` helper
- [ ] Created `index.ts` barrel export
- [ ] Registered all triggers in `triggers/registry.ts`

### Docs and deployment metadata
- [ ] Ran `bun run scripts/generate-docs.ts`
- [ ] Ran `bun run deployment-config:generate` for OAuth or service-account changes
- [ ] Verified docs file created
- [ ] Reviewed and committed the generated `packages/deployment-config/src/integrations.json` change
- [ ] `bun run integration-catalog:check` passes
- [ ] `bun run docs:check` passes — CI fails on stale generated docs, so commit the full generator
      output, including catch-up regeneration for pages another PR left stale (never revert it as
      "unrelated drift")
- [ ] `bun run deployment-config:check` passes

### Final Validation (Required)
- [ ] Read every tool file and cross-referenced inputs/outputs against the API docs
- [ ] Verified block subBlocks cover all required tool params with correct conditions
- [ ] Verified block outputs match what the tools actually return
- [ ] Verified `tools.config.params` correctly maps and coerces all param types
- [ ] Verified every tool output and `transformResponse` path against documented or live-verified JSON responses
- [ ] If any response schema remained unknown, explicitly told the user instead of guessing
- [ ] `{Service}BlockMeta` exported with at least 7 templates, each having `icon`, `title`, `prompt`, `modules`, `category`, and `tags`

## File Handling

When your integration handles file uploads or downloads, follow these patterns to work with `UserFile` objects consistently.

### What is a UserFile?

`UserFile` (`apps/sim/executor/types.ts`) is the standard file representation in Sim — id, name, an access `url` (not guaranteed presigned — `remoteUrl` is the short-lived signed one, set only for providers that fetch by URL), size, MIME `type`, storage `key`, and optional inline `base64` / provider file handles. Read file bytes through the documented upload helpers, never by fetching `url` directly. Read the interface rather than relying on a copy here.

### File Input Pattern (Uploads)

File authorization, normalization, storage reads, provider upload, and response mapping belong in a
registered in-process operation. Do not create an internal API route for file tools.

#### 1. Block SubBlocks for File Input

Use the basic/advanced mode pattern:

```typescript
// Basic mode: File upload UI
{
  id: 'uploadFile',
  title: 'File',
  type: 'file-upload',
  canonicalParamId: 'file',  // Maps to 'file' param
  placeholder: 'Upload file',
  mode: 'basic',
  multiple: false,
  required: true,
  condition: { field: 'operation', value: 'upload' },
},
// Advanced mode: Reference from previous block
{
  id: 'fileRef',
  title: 'File',
  type: 'short-input',
  canonicalParamId: 'file',  // Same canonical param
  placeholder: 'Reference file (e.g., {{file_block.output}})',
  mode: 'advanced',
  required: true,
  condition: { field: 'operation', value: 'upload' },
},
```

**Critical:** `canonicalParamId` must NOT match any subblock `id`.

#### 2. Normalize File Input in Block Config

`tools.config.tool` selects the tool before variable resolution and must not mutate or coerce input.
Use `tools.config.params`, which runs after variable resolution, to normalize all file variants:

```typescript
import { normalizeFileInput } from '@/blocks/utils'

tools: {
  config: {
    tool: (params) => `{service}_${params.operation}`,
    params: (params) => {
      // Serialization collapses the basic/advanced pair into the canonical `file` key.
      const normalizedFile = normalizeFileInput(params.file, { single: true })
      return normalizedFile ? { file: normalizedFile } : {}
    },
  },
}
```

#### 3. Define and register the in-process operation

```typescript
export const {service}UploadTool: InternalToolConfig<Params, Response> = {
  id: '{service}_upload',
  // ...
  params: {
    file: { type: 'file', required: false, visibility: 'user-or-llm' },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      file: params.file,
    }),
  },
}
```

Implement `apps/sim/lib/internal/{service}/execute-tool.ts` and keep the file/provider work in typed
operations beside it. The handler validates `request.input`, derives storage authority only from
trusted `request.context`, authorizes every stored file before reading bytes, forwards
`request.signal`, enforces declared and actual byte caps, and returns the canonical tool response.
Register `{service}_upload` in `apps/sim/lib/internal/tool-operations/registry.server.ts` and add a
registry/direct-handler test. There is no HTTP fallback.

### File Output Pattern (Downloads)

For tools that return files, use `FileToolProcessor` to store files and return `UserFile` objects.

#### In Tool transformResponse

```typescript
import { FileToolProcessor } from '@/executor/utils/file-tool-processor'

transformResponse: async (response, context) => {
  const data = await response.json()

  // Process file outputs to UserFile objects
  const fileProcessor = new FileToolProcessor(context)
  const file = await fileProcessor.processFileData({
    data: data.content,      // base64 or buffer
    mimeType: data.mimeType,
    filename: data.filename,
  })

  return {
    success: true,
    output: { file },
  }
}
```

#### In the operation handler (for complex file handling)

```typescript
// Return file data that FileToolProcessor can handle. No API route is involved.
return Response.json({
  success: true,
  output: {
    file: {
      data: base64Content,
      mimeType: 'application/pdf',
      filename: 'document.pdf',
    },
  },
})
```

### Key Helpers Reference

| Helper | Location | Purpose |
|--------|----------|---------|
| `normalizeFileInput` | `@/blocks/utils` | Normalize file params in block config |
| `processFilesToUserFiles` | `@/lib/uploads/utils/file-utils` | Convert raw inputs to UserFile[] |
| `downloadFileFromStorage` | `@/lib/uploads/utils/file-utils.server` | Get file Buffer from UserFile |
| `FileToolProcessor` | `@/executor/utils/file-tool-processor` | Process tool output files |
| `isUserFile` | `@/lib/core/utils/user-file` | Type guard for UserFile objects |
| `FileInputSchema` | `@/lib/uploads/utils/file-schemas` | Zod schema for file validation |

### Advanced Mode for Optional Fields

Optional fields that are rarely used should be set to `mode: 'advanced'` so they don't clutter the basic UI. Examples: pagination tokens, time range filters, sort order, max results, reply settings.

### WandConfig for Complex Inputs

Use `wandConfig` for fields that are hard to fill out manually:
- **Timestamps**: Use `generationType: 'timestamp'` to inject current date context into the AI prompt
- **JSON arrays**: Use `generationType: 'json-object'` for structured data
- **Complex queries**: Use a descriptive prompt explaining the expected format

```typescript
{
  id: 'startTime',
  title: 'Start Time',
  type: 'short-input',
  mode: 'advanced',
  wandConfig: {
    enabled: true,
    prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
    generationType: 'timestamp',
  },
}
```

### OAuth Scopes (Centralized System)

Scopes are maintained in a single source of truth and reused everywhere:

1. **Define scopes** in `lib/oauth/oauth.ts` under `OAUTH_PROVIDERS[provider].services[service].scopes`
2. **Add descriptions** in `SCOPE_DESCRIPTIONS` within `lib/oauth/utils.ts` for the OAuth modal UI
3. **Reference in auth.ts** using `getCanonicalScopesForProvider(providerId)` from `@/lib/oauth/utils`
4. **Reference in blocks** using `getScopesForService(serviceId)` from `@/lib/oauth/utils`

**Never hardcode scope arrays** in `auth.ts` or block `requiredScopes`. Always import from the centralized source.

```typescript
// In auth.ts (Better Auth config)
scopes: getCanonicalScopesForProvider('{service}'),

// In block credential sub-block
requiredScopes: getScopesForService('{service}'),
```

### Common Gotchas

1. **OAuth serviceId must match** - The `serviceId` in oauth-input must match the OAuth provider configuration
2. **DependsOn clears options** - When an active dependency changes, the shared selector facade
   refetches with an opaque query revision; dependency values and references never enter query keys
3. **Never pass Buffer directly to fetch** - Convert to `new Uint8Array(buffer)` for TypeScript compatibility
4. **Legacy `fileContent` params** - Only an existing tool that already accepted base64 `fileContent` keeps that hidden param; new tools take `file` only
