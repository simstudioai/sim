---
name: validate-connector
description: Audit an existing Sim knowledge base connector against the service API docs and repository conventions, then report and fix issues in auth, config fields, pagination, document mapping, tags, and registry entries. Use when validating or repairing code in `apps/sim/connectors/{service}/`.
---

# Validate Connector Skill

You are an expert auditor for Sim knowledge base connectors. Your job is to thoroughly validate that an existing connector is correct, complete, and follows all conventions.

## Your Task

When the user asks you to validate a connector:
1. Read the service's API documentation (via Context7 or WebFetch)
2. Read the connector implementation, OAuth config, and registry entries
3. Cross-reference everything against the API docs and Sim conventions
4. Report all issues found, grouped by severity (critical, warning, suggestion)
5. Fix all issues after reporting them

## Step 1: Gather All Files

Read **every** file for the connector — do not skip any:

```
apps/sim/connectors/{service}/{service}.ts   # Connector implementation
apps/sim/connectors/{service}/index.ts       # Barrel export
apps/sim/connectors/registry.ts              # Connector registry entry
apps/sim/connectors/types.ts                 # ConnectorConfig interface, ExternalDocument, etc.
apps/sim/connectors/utils.ts                 # Shared utilities (computeContentHash, htmlToPlainText, etc.)
apps/sim/lib/oauth/oauth.ts                  # OAUTH_PROVIDERS — single source of truth for scopes
apps/sim/lib/oauth/utils.ts                  # getCanonicalScopesForProvider, getScopesForService, SCOPE_DESCRIPTIONS
apps/sim/lib/oauth/types.ts                  # OAuthService union type
apps/sim/components/icons.tsx                 # Icon definition for the service
```

If the connector uses selectors, also read:
```
apps/sim/hooks/selectors/registry.ts         # Selector key definitions
apps/sim/hooks/selectors/types.ts            # SelectorKey union type
apps/sim/lib/workflows/subblocks/context.ts  # SELECTOR_CONTEXT_FIELDS
```

## Step 2: Pull API Documentation

Fetch the official API docs for the service. This is the **source of truth** for:
- Endpoint URLs, HTTP methods, and auth headers
- Required vs optional parameters
- Parameter types and allowed values
- Response shapes and field names
- Pagination patterns (cursor, offset, next token)
- Rate limits and error formats
- OAuth scopes and their meanings

Use Context7 (resolve-library-id → query-docs) or WebFetch to retrieve documentation. If both fail, note which claims are based on training knowledge vs verified docs.

## Step 3: Validate API Endpoints

For **every** API call in the connector (`listDocuments`, `getDocument`, `validateConfig`, and any helper functions), verify against the API docs:

### URLs and Methods
- [ ] Base URL is correct for the service's API version
- [ ] Endpoint paths match the API docs exactly
- [ ] HTTP method is correct (GET, POST, PUT, PATCH, DELETE)
- [ ] Path parameters are correctly interpolated and URI-encoded where needed
- [ ] Query parameters use correct names and formats per the API docs

### Headers
- [ ] Authorization header uses the correct format:
  - OAuth: `Authorization: Bearer ${accessToken}`
  - API Key: correct header name per the service's docs
- [ ] `Content-Type` is set for POST/PUT/PATCH requests
- [ ] Any service-specific headers are present (e.g., `Notion-Version`, `Dropbox-API-Arg`)
- [ ] No headers are sent that the API doesn't support or silently ignores

### Request Bodies
- [ ] POST/PUT body fields match API parameter names exactly
- [ ] Required fields are always sent
- [ ] Optional fields are conditionally included (not sent as `null` or empty unless the API expects that)
- [ ] Field value types match API expectations (string vs number vs boolean)

### Input Sanitization
- [ ] User-controlled values interpolated into query strings are properly escaped:
  - OData `$filter`: single quotes escaped with `''` (e.g., `externalId.replace(/'/g, "''")`)
  - SOQL: single quotes escaped with `\'`
  - GraphQL variables: passed as variables, not interpolated into query strings
  - URL path segments: `encodeURIComponent()` applied
- [ ] URL-type config fields (e.g., `siteUrl`, `instanceUrl`) are normalized:
  - Strip `https://` / `http://` prefix if the API expects bare domains
  - Strip trailing `/`
  - Apply `.trim()` before validation

### Response Parsing
- [ ] Response structure is correctly traversed (e.g., `data.results` vs `data.items` vs `data`)
- [ ] Field names extracted match what the API actually returns
- [ ] Nullable fields are handled with `?? null` or `|| undefined`
- [ ] Error responses are checked before accessing data fields

## Step 4: Validate OAuth Scopes (if OAuth connector)

Scopes must be correctly declared and sufficient for all API calls the connector makes.

### Connector requiredScopes
- [ ] `requiredScopes` in the connector's `auth` config lists all scopes needed by the connector
- [ ] Each scope in `requiredScopes` is a real, valid scope recognized by the service's API
- [ ] No invalid, deprecated, or made-up scopes are listed
- [ ] No unnecessary excess scopes beyond what the connector actually needs

### Scope Subset Validation (CRITICAL)
- [ ] Every scope in `requiredScopes` exists in the OAuth provider's `scopes` array in `lib/oauth/oauth.ts`
- [ ] Find the provider in `OAUTH_PROVIDERS[providerGroup].services[serviceId].scopes`
- [ ] Verify: `requiredScopes` ⊆ `OAUTH_PROVIDERS scopes` (every required scope is present in the provider config)
- [ ] If a required scope is NOT in the provider config, flag as **critical** — the connector will fail at runtime

### Scope Sufficiency
For each API endpoint the connector calls:
- [ ] Identify which scopes are required per the API docs
- [ ] Verify those scopes are included in the connector's `requiredScopes`
- [ ] If the connector calls endpoints requiring scopes not in `requiredScopes`, flag as **warning**

### Token Refresh Config
- [ ] Check the `getOAuthTokenRefreshConfig` function in `lib/oauth/oauth.ts` for this provider
- [ ] `useBasicAuth` matches the service's token exchange requirements
- [ ] `supportsRefreshTokenRotation` matches whether the service issues rotating refresh tokens
- [ ] Token endpoint URL is correct

## Step 5: Validate Pagination

### listDocuments Pagination
- [ ] Cursor/pagination parameter name matches the API docs
- [ ] Response pagination field is correctly extracted (e.g., `next_cursor`, `nextPageToken`, `@odata.nextLink`, `offset`)
- [ ] `hasMore` is correctly determined from the response
- [ ] `nextCursor` is correctly passed back for the next page
- [ ] `maxItems` / `maxRecords` cap is correctly applied across pages using `syncContext.totalDocsFetched`
- [ ] Page size is within the API's allowed range (not exceeding max page size)
- [ ] Last page precision: when a `maxItems` cap exists, the final page request uses `Math.min(PAGE_SIZE, remaining)` to avoid fetching more records than needed
- [ ] No off-by-one errors in pagination tracking
- [ ] The connector does NOT hit known API pagination limits silently (e.g., HubSpot search 10k cap)

### Pagination State Across Pages
- [ ] `syncContext` is used to cache state across pages (user names, field maps, instance URLs, portal IDs, etc.)
- [ ] Cached state in `syncContext` is correctly initialized on first page and reused on subsequent pages

## Step 6: Validate Data Transformation

### Content Deferral (CRITICAL)
Connectors that require per-document API calls to fetch content (file download, export, blocks fetch) MUST use `contentDeferred: true`. This is the standard pattern for reliability — without it, content downloads during listing can exhaust the sync task's time budget before any documents are saved.

- [ ] If the connector downloads content per-doc during `listDocuments`, it MUST use `contentDeferred: true` instead
- [ ] `listDocuments` returns lightweight stubs with `content: ''` and `contentDeferred: true`
- [ ] `getDocument` fetches actual content and returns the full document with `contentDeferred: false`
- [ ] A shared stub function (e.g., `fileToStub`) is used by both `listDocuments` and `getDocument` to guarantee `contentHash` consistency
- [ ] `contentHash` is metadata-based (e.g., `service:{id}:{modifiedTime}`), NOT content-based — it must be derivable from list metadata alone
- [ ] The `contentHash` is identical whether produced by `listDocuments` or `getDocument`

Connectors where the list API already returns content inline (e.g., Slack messages, Reddit posts) do NOT need `contentDeferred`.

### ExternalDocument Construction
- [ ] `externalId` is a stable, unique identifier from the source API
- [ ] `title` is extracted from the correct field and has a sensible fallback (e.g., `'Untitled'`)
- [ ] `content` is plain text — HTML content is stripped using `htmlToPlainText` from `@/connectors/utils`
- [ ] `mimeType` is `'text/plain'`
- [ ] `contentHash` uses a metadata-based format (e.g., `service:{id}:{modifiedTime}`) for connectors with `contentDeferred: true`, or `computeContentHash` from `@/connectors/utils` for inline-content connectors
- [ ] `sourceUrl` is a valid, complete URL back to the original resource (not relative)
- [ ] `metadata` contains all fields referenced by `mapTags` and `tagDefinitions`

### Content Extraction
- [ ] Rich text / HTML fields are converted to plain text before indexing
- [ ] Important content is not silently dropped (e.g., nested blocks, table cells, code blocks)
- [ ] Content is not silently truncated without logging a warning
- [ ] Empty/blank documents are properly filtered out
- [ ] Size checks use `Buffer.byteLength(text, 'utf8')` not `text.length` when comparing against byte-based limits (e.g., `MAX_FILE_SIZE` in bytes)

## Step 7: Validate Tag Definitions and mapTags

### tagDefinitions
- [ ] Each `tagDefinition` has an `id`, `displayName`, and `fieldType`
- [ ] `fieldType` matches the actual data type: `'text'` for strings, `'number'` for numbers, `'date'` for dates, `'boolean'` for booleans
- [ ] Every `id` in `tagDefinitions` is returned by `mapTags`
- [ ] No `tagDefinition` references a field that `mapTags` never produces

### mapTags
- [ ] Return keys match `tagDefinition` `id` values exactly
- [ ] Date values are properly parsed using `parseTagDate` from `@/connectors/utils`
- [ ] Array values are properly joined using `joinTagArray` from `@/connectors/utils`
- [ ] Number values are validated (not `NaN`)
- [ ] Metadata field names accessed in `mapTags` match what `listDocuments`/`getDocument` store in `metadata`

## Step 8: Validate Config Fields and Validation

### configFields
- [ ] Every field has `id`, `title`, `type`
- [ ] `required` is set explicitly (not omitted)
- [ ] Dropdown fields have `options` with `label` and `id` for each option
- [ ] Selector fields follow the canonical pair pattern:
  - A `type: 'selector'` field with `selectorKey`, `canonicalParamId`, `mode: 'basic'`
  - A `type: 'short-input'` field with the same `canonicalParamId`, `mode: 'advanced'`
  - `required` is identical on both fields in the pair
- [ ] `selectorKey` values exist in the selector registry
- [ ] `dependsOn` references selector field `id` values, not `canonicalParamId`

### validateConfig
- [ ] Validates all required fields are present before making API calls
- [ ] Validates optional numeric fields (checks `Number.isNaN`, positive values)
- [ ] Makes a lightweight API call to verify access (e.g., fetch 1 record, get profile)
- [ ] Uses `VALIDATE_RETRY_OPTIONS` for retry budget
- [ ] Returns `{ valid: true }` on success
- [ ] Returns `{ valid: false, error: 'descriptive message' }` on failure
- [ ] Catches exceptions and returns user-friendly error messages
- [ ] Does NOT make expensive calls (full data listing, large queries)

## Step 9: Validate getDocument

- [ ] Fetches a single document by `externalId`
- [ ] Returns `null` for 404 / not found (does not throw)
- [ ] Returns the same `ExternalDocument` shape as `listDocuments`
- [ ] If `listDocuments` uses `contentDeferred: true`, `getDocument` MUST fetch actual content and return `contentDeferred: false`
- [ ] If `listDocuments` uses `contentDeferred: true`, `getDocument` MUST use the same stub function to ensure `contentHash` is identical
- [ ] Handles all content types that `listDocuments` can produce (e.g., if `listDocuments` returns both pages and blogposts, `getDocument` must handle both — not hardcode one endpoint)
- [ ] Forwards `syncContext` if it needs cached state (user names, field maps, etc.)
- [ ] Error handling is graceful (catches, logs, returns null or throws with context)
- [ ] Does not redundantly re-fetch data already included in the initial API response (e.g., if comments come back with the post, don't fetch them again separately)

## Step 10: Validate General Quality

### fetchWithRetry Usage
- [ ] All external API calls use `fetchWithRetry` from `@/lib/knowledge/documents/utils`
- [ ] No raw `fetch()` calls to external APIs
- [ ] `VALIDATE_RETRY_OPTIONS` used in `validateConfig`
- [ ] If `validateConfig` calls a shared helper (e.g., `linearGraphQL`, `resolveId`), that helper must accept and forward `retryOptions` to `fetchWithRetry`
- [ ] Default retry options used in `listDocuments`/`getDocument`

### API Efficiency
- [ ] APIs that support field selection (e.g., `$select`, `sysparm_fields`, `fields`) should request only the fields the connector needs — in both `listDocuments` AND `getDocument`
- [ ] No redundant API calls: if a helper already fetches data (e.g., site metadata), callers should reuse the result instead of making a second call for the same information
- [ ] Sequential per-item API calls (fetching details for each document in a loop) should be batched with `Promise.all` and a concurrency limit of 3-5

### Error Handling
- [ ] Individual document failures are caught and logged without aborting the sync
- [ ] API error responses include status codes in error messages
- [ ] No unhandled promise rejections in concurrent operations

### Concurrency
- [ ] Concurrent API calls use reasonable batch sizes (3-5 is typical)
- [ ] No unbounded `Promise.all` over large arrays

### Logging
- [ ] Uses `createLogger` from `@sim/logger` (not `console.log`)
- [ ] Logs sync progress at `info` level
- [ ] Logs errors at `warn` or `error` level with context

### Registry
- [ ] Connector is exported from `connectors/{service}/index.ts`
- [ ] Connector is registered in `connectors/registry.ts`
- [ ] Registry key matches the connector's `id` field

## Step 11: Report and Fix

### Report Format

Group findings by severity:

**Critical** (will cause runtime errors, data loss, or auth failures):
- Wrong API endpoint URL or HTTP method
- Invalid or missing OAuth scopes (not in provider config)
- Incorrect response field mapping (accessing wrong path)
- SOQL/query fields that don't exist on the target object
- Pagination that silently hits undocumented API limits
- Missing error handling that would crash the sync
- `requiredScopes` not a subset of OAuth provider scopes
- Query/filter injection: user-controlled values interpolated into OData `$filter`, SOQL, or query strings without escaping
- Per-document content download in `listDocuments` without `contentDeferred: true` — causes sync timeouts for large document sets
- `contentHash` mismatch between `listDocuments` stub and `getDocument` return — causes unnecessary re-processing every sync

**Warning** (incorrect behavior, data quality issues, or convention violations):
- HTML content not stripped via `htmlToPlainText`
- `getDocument` not forwarding `syncContext`
- `getDocument` hardcoded to one content type when `listDocuments` returns multiple (e.g., only pages but not blogposts)
- Missing `tagDefinition` for metadata fields returned by `mapTags`
- Incorrect `useBasicAuth` or `supportsRefreshTokenRotation` in token refresh config
- Invalid scope names that the API doesn't recognize (even if silently ignored)
- Private resources excluded from name-based lookup despite scopes being available
- Silent data truncation without logging
- Size checks using `text.length` (character count) instead of `Buffer.byteLength` (byte count) for byte-based limits
- URL-type config fields not normalized (protocol prefix, trailing slashes cause API failures)
- `VALIDATE_RETRY_OPTIONS` not threaded through helper functions called by `validateConfig`

**Suggestion** (minor improvements):
- Missing incremental sync support despite API supporting it
- Overly broad scopes that could be narrowed (not wrong, but could be tighter)
- Source URL format could be more specific
- Missing `orderBy` for deterministic pagination
- Redundant API calls that could be cached in `syncContext`
- Sequential per-item API calls that could be batched with `Promise.all` (concurrency 3-5)
- API supports field selection but connector fetches all fields (e.g., missing `$select`, `sysparm_fields`, `fields`)
- `getDocument` re-fetches data already included in the initial API response (e.g., comments returned with post)
- Last page of pagination requests full `PAGE_SIZE` when fewer records remain (`Math.min(PAGE_SIZE, remaining)`)

### Fix All Issues

After reporting, fix every **critical** and **warning** issue. Apply **suggestions** where they don't add unnecessary complexity.

### Validation Output

After fixing, confirm:
1. `bun run lint` passes
2. TypeScript compiles clean
3. Re-read all modified files to verify fixes are correct

## Checklist Summary

- [ ] Read connector implementation, types, utils, registry, and OAuth config
- [ ] Pulled and read official API documentation for the service
- [ ] Validated every API endpoint URL, method, headers, and body against API docs
- [ ] Validated input sanitization: no query/filter injection, URL fields normalized
- [ ] Validated OAuth scopes: `requiredScopes` ⊆ OAuth provider `scopes` in `oauth.ts`
- [ ] Validated each scope is real and recognized by the service's API
- [ ] Validated scopes are sufficient for all API endpoints the connector calls
- [ ] Validated token refresh config (`useBasicAuth`, `supportsRefreshTokenRotation`)
- [ ] Validated pagination: cursor names, page sizes, hasMore logic, no silent caps
- [ ] Validated content deferral: `contentDeferred: true` used when per-doc content fetch required, metadata-based `contentHash` consistent between stub and `getDocument`
- [ ] Validated data transformation: plain text extraction, HTML stripping, content hashing
- [ ] Validated tag definitions match mapTags output, correct fieldTypes
- [ ] Validated config fields: canonical pairs, selector keys, required flags
- [ ] Validated validateConfig: lightweight check, error messages, retry options
- [ ] Validated getDocument: null on 404, all content types handled, no redundant re-fetches, syncContext forwarding
- [ ] Validated fetchWithRetry used for all external calls (no raw fetch), VALIDATE_RETRY_OPTIONS threaded through helpers
- [ ] Validated API efficiency: field selection used, no redundant calls, sequential fetches batched
- [ ] Validated error handling: graceful failures, no unhandled rejections
- [ ] Validated logging: createLogger, no console.log
- [ ] Validated registry: correct export, correct key
- [ ] Reported all issues grouped by severity
- [ ] Fixed all critical and warning issues
- [ ] Ran `bun run lint` after fixes
- [ ] Verified TypeScript compiles clean
