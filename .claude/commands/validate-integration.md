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

Read every file for the integration:

```
apps/sim/tools/{service}/          # All tool files, types.ts, index.ts
apps/sim/blocks/blocks/{service}.ts # Block definition
apps/sim/tools/registry.ts          # Tool registry entries
apps/sim/blocks/registry.ts         # Block registry entry
```

## Step 2: Pull API Documentation

Fetch the official API docs for the service. This is the source of truth for:
- Endpoint URLs, HTTP methods, and auth headers
- Required vs optional parameters
- Parameter types and allowed values
- Response shapes and field names
- Pagination patterns

## Step 3: Validate Tools

For **every** tool file, check:

### Params
- [ ] All required API params are marked `required: true`
- [ ] All optional API params are marked `required: false`
- [ ] Param types match the API (`'string'`, `'number'`, `'boolean'`, `'json'`)
- [ ] Visibility is correct:
  - `'hidden'` for OAuth access tokens and system-injected params only
  - `'user-only'` for API keys, credentials, and account-specific IDs
  - `'user-or-llm'` for everything else (search queries, content, filters, etc.)
- [ ] All tool IDs use `snake_case` (`{service}_{action}`)

### Request
- [ ] URL matches the API endpoint (correct base URL, path, path params)
- [ ] HTTP method matches the API spec (GET, POST, PUT, PATCH, DELETE)
- [ ] Headers include correct auth (Bearer token, API key header, etc.)
- [ ] Body sends all required fields
- [ ] Query params are passed correctly (for GET requests)
- [ ] ID fields are `.trim()`-ed to prevent copy-paste whitespace errors

### Response
- [ ] `transformResponse` extracts the correct fields from the API response
- [ ] All nullable fields use `?? null`
- [ ] All optional arrays use `?? []`
- [ ] Error cases are handled (check for `!data.data` or similar patterns)
- [ ] Logger is imported and used for error logging

### Outputs
- [ ] All output fields match what the API actually returns
- [ ] No fields are missing that the API provides and users would need
- [ ] No phantom fields are defined that the API doesn't return
- [ ] `optional: true` is set on fields that may not exist in all responses
- [ ] `type: 'json'` outputs define `properties` when the shape is known
- [ ] `type: 'array'` outputs define `items` with the item structure

### Types
- [ ] `types.ts` has interfaces for all param types
- [ ] `types.ts` has interfaces for all response types (extending `ToolResponse`)
- [ ] Optional params use `?` in the interface
- [ ] Types match actual API field names

### Registry
- [ ] All tools are exported from `index.ts`
- [ ] All tools are registered in `tools/registry.ts` with snake_case keys
- [ ] Registry keys match tool IDs exactly

## Step 4: Validate Block

### SubBlocks
- [ ] Operation dropdown lists all tool operations
- [ ] Dropdown option IDs match tool IDs (if using `tool: (params) => params.operation` pattern)
- [ ] Every required tool param has a corresponding subBlock input
- [ ] Conditions are correct — each subBlock only shows for the operations that use it
- [ ] Condition values use arrays when a field applies to multiple operations
- [ ] Required fields are marked `required: true` (or conditional required)
- [ ] OAuth/credential field has correct `serviceId`
- [ ] `dependsOn` is set for fields that need other values (e.g., selectors depending on credential)

### Advanced Mode
- [ ] Optional, rarely-used fields are set to `mode: 'advanced'`:
  - Pagination tokens
  - Time range filters (start/end time)
  - Sort order / direction options
  - Max results / limits
  - Reply settings
  - Rarely used IDs
- [ ] Required fields are NOT set to `mode: 'advanced'`

### WandConfig
- [ ] Timestamp fields have `wandConfig` with `generationType: 'timestamp'`
- [ ] Complex inputs (filters, queries, comma-separated lists) have `wandConfig` with descriptive prompts
- [ ] WandConfig prompts end with "Return ONLY the [format] - no explanations, no extra text."

### Tools Config
- [ ] `tools.access` lists every tool ID the block uses
- [ ] `tools.config.tool` returns the correct tool ID for each operation
- [ ] `tools.config.params` handles type coercions (Number(), Boolean(), JSON.parse()) — NOT in `tools.config.tool`
- [ ] Empty string dropdown values are converted to `undefined` in params

### Outputs
- [ ] Block outputs cover the key fields returned by all tools
- [ ] Output types are correct (`'string'`, `'number'`, `'boolean'`, `'json'`)
- [ ] `type: 'json'` outputs describe inner fields in the description (or use nested definitions)

### Block Metadata
- [ ] `type` is snake_case
- [ ] `name` is human-readable
- [ ] `description` is a concise one-liner
- [ ] `longDescription` provides detail for docs
- [ ] `docsLink` points to correct docs URL
- [ ] `category` is `'tools'`
- [ ] `bgColor` matches the service's brand color
- [ ] `icon` references the correct icon component
- [ ] `authMode` is set correctly (OAuth or ApiKey)
- [ ] Block is registered in `blocks/registry.ts` alphabetically

## Step 5: Report and Fix

### Report Format

Group findings by severity:

**Critical** (will cause runtime errors or incorrect behavior):
- Wrong endpoint URL
- Missing required params
- Wrong HTTP method
- Incorrect response field mapping
- Missing error handling

**Warning** (follows conventions incorrectly or has usability issues):
- Optional field not set to `mode: 'advanced'`
- Missing `wandConfig` on timestamp/complex fields
- Wrong visibility on params
- Missing `optional: true` on nullable outputs
- Opaque `type: 'json'` without property descriptions

**Suggestion** (minor improvements):
- Better description text
- Missing `.trim()` on ID fields
- Inconsistent naming

### Fix All Issues

After reporting, fix every critical and warning issue. Apply suggestions where they don't add unnecessary complexity.

## Checklist Summary

- [ ] Read all tool files for the service
- [ ] Pulled and read official API documentation
- [ ] Validated every tool's params, request, response, and outputs against API docs
- [ ] Validated block subBlocks, conditions, modes, and wandConfig
- [ ] Validated tools.config mapping and type coercions
- [ ] Validated registry entries
- [ ] Reported all issues grouped by severity
- [ ] Fixed all critical and warning issues
- [ ] Ran `bun run lint` after fixes
- [ ] Verified TypeScript compiles clean
