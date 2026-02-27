---
description: Validate an existing Sim integration (tools, block, registry) against the service's API docs
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
apps/sim/blocks/registry.ts         # Block registry entry for this service
apps/sim/components/icons.tsx        # Icon definition
apps/sim/lib/auth/auth.ts           # OAuth scopes (if OAuth service)
apps/sim/lib/oauth/oauth.ts         # OAuth provider config (if OAuth service)
```

## Step 2: Pull API Documentation

Fetch the official API docs for the service. This is the **source of truth** for:
- Endpoint URLs, HTTP methods, and auth headers
- Required vs optional parameters
- Parameter types and allowed values
- Response shapes and field names
- Pagination patterns (which param name, which response field)
- Rate limits and error formats

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

### Request
- [ ] URL matches the API endpoint exactly (correct base URL, path segments, path params)
- [ ] HTTP method matches the API spec (GET, POST, PUT, PATCH, DELETE)
- [ ] Headers include correct auth pattern:
  - OAuth: `Authorization: Bearer ${params.accessToken}`
  - API Key: correct header name and format per the service's docs
- [ ] `Content-Type` header is set for POST/PUT/PATCH requests
- [ ] Body sends all required fields and only includes optional fields when provided
- [ ] For GET requests with query params: URL is constructed correctly with query string
- [ ] ID fields in URL paths are `.trim()`-ed to prevent copy-paste whitespace errors
- [ ] Path params use template literals correctly: `` `https://api.service.com/v1/${params.id.trim()}` ``

### Response / transformResponse
- [ ] Correctly parses the API response (`await response.json()`)
- [ ] Extracts the right fields from the response structure (e.g., `data.data` vs `data` vs `data.results`)
- [ ] All nullable fields use `?? null`
- [ ] All optional arrays use `?? []`
- [ ] Error cases are handled: checks for missing/empty data and returns meaningful error
- [ ] `createLogger` is imported from `@sim/logger` and used for error logging
- [ ] Does NOT do raw JSON dumps — extracts meaningful, individual fields

### Outputs
- [ ] All output fields match what the API actually returns
- [ ] No fields are missing that the API provides and users would commonly need
- [ ] No phantom fields defined that the API doesn't return
- [ ] `optional: true` is set on fields that may not exist in all responses
- [ ] When using `type: 'json'` and the shape is known, `properties` defines the inner fields
- [ ] When using `type: 'array'`, `items` defines the item structure with `properties`
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
- [ ] `type: 'json'` outputs either:
  - Describe inner fields in the description string (GOOD): `'User profile (id, name, username, bio)'`
  - Use nested output definitions (BEST): `{ id: { type: 'string' }, name: { type: 'string' } }`
- [ ] No opaque `type: 'json'` with vague descriptions like `'Response data'`
- [ ] Outputs that only appear for certain operations use `condition` if supported, or document which operations return them

### Block Metadata
- [ ] `type` is snake_case (e.g., `'x'`, `'cloudflare'`)
- [ ] `name` is human-readable (e.g., `'X'`, `'Cloudflare'`)
- [ ] `description` is a concise one-liner
- [ ] `longDescription` provides detail for docs
- [ ] `docsLink` points to `'https://docs.sim.ai/tools/{service}'`
- [ ] `category` is `'tools'`
- [ ] `bgColor` uses the service's brand color hex
- [ ] `icon` references the correct icon component from `@/components/icons`
- [ ] `authMode` is set correctly (`AuthMode.OAuth` or `AuthMode.ApiKey`)
- [ ] Block is registered in `blocks/registry.ts` alphabetically

### Block Inputs
- [ ] `inputs` section lists all subBlock params that the block accepts
- [ ] Input types match the subBlock types
- [ ] When using `canonicalParamId`, inputs list the canonical ID (not the raw subBlock IDs)

## Step 5: Validate OAuth Scopes (if OAuth service)

- [ ] `auth.ts` scopes include ALL scopes needed by ALL tools in the integration
- [ ] `oauth.ts` provider config scopes match `auth.ts` scopes
- [ ] Block `requiredScopes` (if defined) matches `auth.ts` scopes
- [ ] No excess scopes that aren't needed by any tool
- [ ] Each scope has a human-readable description in `oauth-required-modal.tsx`'s `SCOPE_DESCRIPTIONS`

## Step 6: Validate Pagination Consistency

If any tools support pagination:
- [ ] Pagination param names match the API docs (e.g., `pagination_token` vs `next_token` vs `cursor`)
- [ ] Different API endpoints that use different pagination param names have separate subBlocks in the block
- [ ] Pagination response fields (`nextToken`, `cursor`, etc.) are included in tool outputs
- [ ] Pagination subBlocks are set to `mode: 'advanced'`

## Step 7: Validate Error Handling

- [ ] Every tool imports `createLogger` from `@sim/logger`
- [ ] Every tool creates a logger: `const logger = createLogger('{ToolName}')`
- [ ] `transformResponse` checks for error conditions before accessing data
- [ ] Error responses include meaningful messages (not just generic "failed")
- [ ] HTTP error status codes are handled (check `response.ok` or status codes)

## Step 8: Report and Fix

### Report Format

Group findings by severity:

**Critical** (will cause runtime errors or incorrect behavior):
- Wrong endpoint URL or HTTP method
- Missing required params or wrong `required` flag
- Incorrect response field mapping (accessing wrong path in response)
- Missing error handling that would cause crashes
- Tool ID mismatch between tool file, registry, and block `tools.access`
- OAuth scopes missing in `auth.ts` that tools need
- `tools.config.tool` returning wrong tool ID for an operation
- Type coercions in `tools.config.tool` instead of `tools.config.params`

**Warning** (follows conventions incorrectly or has usability issues):
- Optional field not set to `mode: 'advanced'`
- Missing `wandConfig` on timestamp/complex fields
- Wrong `visibility` on params (e.g., `'hidden'` instead of `'user-or-llm'`)
- Missing `optional: true` on nullable outputs
- Opaque `type: 'json'` without property descriptions
- Missing `.trim()` on ID fields in request URLs
- Missing `?? null` on nullable response fields
- Block condition array missing an operation that uses that field
- Missing scope description in `oauth-required-modal.tsx`

**Suggestion** (minor improvements):
- Better description text
- Inconsistent naming across tools
- Missing `longDescription` or `docsLink`
- Pagination fields that could benefit from `wandConfig`

### Fix All Issues

After reporting, fix every **critical** and **warning** issue. Apply **suggestions** where they don't add unnecessary complexity.

### Validation Output

After fixing, confirm:
1. `bun run lint` passes with no fixes needed
2. TypeScript compiles clean (no type errors)
3. Re-read all modified files to verify fixes are correct

## Checklist Summary

- [ ] Read ALL tool files, block, types, index, and registries
- [ ] Pulled and read official API documentation
- [ ] Validated every tool's ID, params, request, response, outputs, and types against API docs
- [ ] Validated block ↔ tool alignment (every tool param has a subBlock, every condition is correct)
- [ ] Validated advanced mode on optional/rarely-used fields
- [ ] Validated wandConfig on timestamps and complex inputs
- [ ] Validated tools.config mapping, tool selector, and type coercions
- [ ] Validated block outputs match what tools return, with typed JSON where possible
- [ ] Validated OAuth scopes alignment across auth.ts, oauth.ts, block, and modal (if OAuth)
- [ ] Validated pagination consistency across tools and block
- [ ] Validated error handling (logger, error checks, meaningful messages)
- [ ] Validated registry entries (tools and block, alphabetical, correct imports)
- [ ] Reported all issues grouped by severity
- [ ] Fixed all critical and warning issues
- [ ] Ran `bun run lint` after fixes
- [ ] Verified TypeScript compiles clean
