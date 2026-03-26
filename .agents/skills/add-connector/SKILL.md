---
name: add-connector
description: Add or update a Sim knowledge base connector for syncing documents from an external source, including auth mode, config fields, pagination, document mapping, tags, and registry wiring. Use when working in `apps/sim/connectors/{service}/` or adding a new external document source.
---

# Add Connector Skill

You are an expert at adding knowledge base connectors to Sim. A connector syncs documents from an external source (Confluence, Google Drive, Notion, etc.) into a knowledge base.

## Your Task

When the user asks you to create a connector:
1. Use Context7 or WebFetch to read the service's API documentation
2. Determine the auth mode: **OAuth** (if Sim already has an OAuth provider for the service) or **API key** (if the service uses API key / Bearer token auth)
3. Create the connector directory and config
4. Register it in the connector registry

## Directory Structure

Create files in `apps/sim/connectors/{service}/`:
```
connectors/{service}/
├── index.ts          # Barrel export
└── {service}.ts      # ConnectorConfig definition
```

## Authentication

Connectors use a discriminated union for auth config (`ConnectorAuthConfig` in `connectors/types.ts`):

```typescript
type ConnectorAuthConfig =
  | { mode: 'oauth'; provider: OAuthService; requiredScopes?: string[] }
  | { mode: 'apiKey'; label?: string; placeholder?: string }
```

### OAuth mode
For services with existing OAuth providers in `apps/sim/lib/oauth/types.ts`. The `provider` must match an `OAuthService`. The modal shows a credential picker and handles token refresh automatically.

### API key mode
For services that use API key / Bearer token auth. The modal shows a password input with the configured `label` and `placeholder`. The API key is encrypted at rest using AES-256-GCM and stored in a dedicated `encryptedApiKey` column on the connector record. The sync engine decrypts it automatically — connectors receive the raw access token in `listDocuments`, `getDocument`, and `validateConfig`.

## ConnectorConfig Structure

### OAuth connector example

```typescript
import { createLogger } from '@sim/logger'
import { {Service}Icon } from '@/components/icons'
import { fetchWithRetry } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'

const logger = createLogger('{Service}Connector')

export const {service}Connector: ConnectorConfig = {
  id: '{service}',
  name: '{Service}',
  description: 'Sync documents from {Service} into your knowledge base',
  version: '1.0.0',
  icon: {Service}Icon,

  auth: {
    mode: 'oauth',
    provider: '{service}',          // Must match OAuthService in lib/oauth/types.ts
    requiredScopes: ['read:...'],
  },

  configFields: [
    // Rendered dynamically by the add-connector modal UI
    // Supports 'short-input' and 'dropdown' types
  ],

  listDocuments: async (accessToken, sourceConfig, cursor) => {
    // Return metadata stubs with contentDeferred: true (if per-doc content fetch needed)
    // Or full documents with content (if list API returns content inline)
    // Return { documents: ExternalDocument[], nextCursor?, hasMore }
  },

  getDocument: async (accessToken, sourceConfig, externalId) => {
    // Fetch full content for a single document
    // Return ExternalDocument with contentDeferred: false, or null
  },

  validateConfig: async (accessToken, sourceConfig) => {
    // Return { valid: true } or { valid: false, error: 'message' }
  },

  // Optional: map source metadata to semantic tag keys (translated to slots by sync engine)
  mapTags: (metadata) => {
    // Return Record<string, unknown> with keys matching tagDefinitions[].id
  },
}
```

### API key connector example

```typescript
export const {service}Connector: ConnectorConfig = {
  id: '{service}',
  name: '{Service}',
  description: 'Sync documents from {Service} into your knowledge base',
  version: '1.0.0',
  icon: {Service}Icon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',                       // Shown above the input field
    placeholder: 'Enter your {Service} API key',  // Input placeholder
  },

  configFields: [ /* ... */ ],
  listDocuments: async (accessToken, sourceConfig, cursor) => { /* ... */ },
  getDocument: async (accessToken, sourceConfig, externalId) => { /* ... */ },
  validateConfig: async (accessToken, sourceConfig) => { /* ... */ },
}
```

## ConfigField Types

The add-connector modal renders these automatically — no custom UI needed.

Three field types are supported: `short-input`, `dropdown`, and `selector`.

```typescript
// Text input
{
  id: 'domain',
  title: 'Domain',
  type: 'short-input',
  placeholder: 'yoursite.example.com',
  required: true,
}

// Dropdown (static options)
{
  id: 'contentType',
  title: 'Content Type',
  type: 'dropdown',
  required: false,
  options: [
    { label: 'Pages only', id: 'page' },
    { label: 'Blog posts only', id: 'blogpost' },
    { label: 'All content', id: 'all' },
  ],
}
```

## Dynamic Selectors (Canonical Pairs)

Use `type: 'selector'` to fetch options dynamically from the existing selector registry (`hooks/selectors/registry.ts`). Selectors are always paired with a manual fallback input using the **canonical pair** pattern — a `selector` field (basic mode) and a `short-input` field (advanced mode) linked by `canonicalParamId`.

The user sees a toggle button (ArrowLeftRight) to switch between the selector dropdown and manual text input. On submit, the modal resolves each canonical pair to the active mode's value, keyed by `canonicalParamId`.

### Rules

1. **Every selector field MUST have a canonical pair** — a corresponding `short-input` (or `dropdown`) field with the same `canonicalParamId` and `mode: 'advanced'`.
2. **`required` must be set identically on both fields** in a pair. If the selector is required, the manual input must also be required.
3. **`canonicalParamId` must match the key the connector expects in `sourceConfig`** (e.g. `baseId`, `channel`, `teamId`). The advanced field's `id` should typically match `canonicalParamId`.
4. **`dependsOn` references the selector field's `id`**, not the `canonicalParamId`. The modal propagates dependency clearing across canonical siblings automatically — changing either field in a parent pair clears dependent children.

### Selector canonical pair example (Airtable base → table cascade)

```typescript
configFields: [
  // Base: selector (basic) + manual (advanced)
  {
    id: 'baseSelector',
    title: 'Base',
    type: 'selector',
    selectorKey: 'airtable.bases',     // Must exist in hooks/selectors/registry.ts
    canonicalParamId: 'baseId',
    mode: 'basic',
    placeholder: 'Select a base',
    required: true,
  },
  {
    id: 'baseId',
    title: 'Base ID',
    type: 'short-input',
    canonicalParamId: 'baseId',
    mode: 'advanced',
    placeholder: 'e.g. appXXXXXXXXXXXXXX',
    required: true,
  },
  // Table: selector depends on base (basic) + manual (advanced)
  {
    id: 'tableSelector',
    title: 'Table',
    type: 'selector',
    selectorKey: 'airtable.tables',
    canonicalParamId: 'tableIdOrName',
    mode: 'basic',
    dependsOn: ['baseSelector'],       // References the selector field ID
    placeholder: 'Select a table',
    required: true,
  },
  {
    id: 'tableIdOrName',
    title: 'Table Name or ID',
    type: 'short-input',
    canonicalParamId: 'tableIdOrName',
    mode: 'advanced',
    placeholder: 'e.g. Tasks',
    required: true,
  },
  // Non-selector fields stay as-is
  { id: 'maxRecords', title: 'Max Records', type: 'short-input', ... },
]
```

### Selector with domain dependency (Jira/Confluence pattern)

When a selector depends on a plain `short-input` field (no canonical pair), `dependsOn` references that field's `id` directly. The `domain` field's value maps to `SelectorContext.domain` automatically via `SELECTOR_CONTEXT_FIELDS`.

```typescript
configFields: [
  {
    id: 'domain',
    title: 'Jira Domain',
    type: 'short-input',
    placeholder: 'yoursite.atlassian.net',
    required: true,
  },
  {
    id: 'projectSelector',
    title: 'Project',
    type: 'selector',
    selectorKey: 'jira.projects',
    canonicalParamId: 'projectKey',
    mode: 'basic',
    dependsOn: ['domain'],
    placeholder: 'Select a project',
    required: true,
  },
  {
    id: 'projectKey',
    title: 'Project Key',
    type: 'short-input',
    canonicalParamId: 'projectKey',
    mode: 'advanced',
    placeholder: 'e.g. ENG, PROJ',
    required: true,
  },
]
```

### How `dependsOn` maps to `SelectorContext`

The connector selector field builds a `SelectorContext` from dependency values. For the mapping to work, each dependency's `canonicalParamId` (or field `id` for non-canonical fields) must exist in `SELECTOR_CONTEXT_FIELDS` (`lib/workflows/subblocks/context.ts`):

```
oauthCredential, domain, teamId, projectId, knowledgeBaseId, planId,
siteId, collectionId, spreadsheetId, fileId, baseId, datasetId, serviceDeskId
```

### Available selector keys

Check `hooks/selectors/types.ts` for the full `SelectorKey` union. Common ones for connectors:

| SelectorKey | Context Deps | Returns |
|-------------|-------------|---------|
| `airtable.bases` | credential | Base ID + name |
| `airtable.tables` | credential, `baseId` | Table ID + name |
| `slack.channels` | credential | Channel ID + name |
| `gmail.labels` | credential | Label ID + name |
| `google.calendar` | credential | Calendar ID + name |
| `linear.teams` | credential | Team ID + name |
| `linear.projects` | credential, `teamId` | Project ID + name |
| `jira.projects` | credential, `domain` | Project key + name |
| `confluence.spaces` | credential, `domain` | Space key + name |
| `notion.databases` | credential | Database ID + name |
| `asana.workspaces` | credential | Workspace GID + name |
| `microsoft.teams` | credential | Team ID + name |
| `microsoft.channels` | credential, `teamId` | Channel ID + name |
| `webflow.sites` | credential | Site ID + name |
| `outlook.folders` | credential | Folder ID + name |

## ExternalDocument Shape

Every document returned from `listDocuments`/`getDocument` must include:

```typescript
{
  externalId: string          // Source-specific unique ID
  title: string               // Document title
  content: string             // Extracted plain text (or '' if contentDeferred)
  contentDeferred?: boolean   // true = content will be fetched via getDocument
  mimeType: 'text/plain'     // Always text/plain (content is extracted)
  contentHash: string         // Metadata-based hash for change detection
  sourceUrl?: string          // Link back to original (stored on document record)
  metadata?: Record<string, unknown>  // Source-specific data (fed to mapTags)
}
```

## Content Deferral (Required for file/content-download connectors)

**All connectors that require per-document API calls to fetch content MUST use `contentDeferred: true`.** This is the standard pattern — `listDocuments` returns lightweight metadata stubs, and content is fetched lazily by the sync engine via `getDocument` only for new/changed documents.

This pattern is critical for reliability: the sync engine processes documents in batches and enqueues each batch for processing immediately. If a sync times out, all previously-batched documents are already queued. Without deferral, content downloads during listing can exhaust the sync task's time budget before any documents are saved.

### When to use `contentDeferred: true`

- The service's list API does NOT return document content (only metadata)
- Content requires a separate download/export API call per document
- Examples: Google Drive, OneDrive, SharePoint, Dropbox, Notion, Confluence, Gmail, Obsidian, Evernote, GitHub

### When NOT to use `contentDeferred`

- The list API already returns the full content inline (e.g., Slack messages, Reddit posts, HubSpot notes)
- No per-document API call is needed to get content

### Content Hash Strategy

Use a **metadata-based** `contentHash` — never a content-based hash. The hash must be derivable from the list response metadata alone, so the sync engine can detect changes without downloading content.

Good metadata hash sources:
- `modifiedTime` / `lastModifiedDateTime` — changes when file is edited
- Git blob SHA — unique per content version
- API-provided content hash (e.g., Dropbox `content_hash`)
- Version number (e.g., Confluence page version)

Format: `{service}:{id}:{changeIndicator}`

```typescript
// Google Drive: modifiedTime changes on edit
contentHash: `gdrive:${file.id}:${file.modifiedTime ?? ''}`

// GitHub: blob SHA is a content-addressable hash
contentHash: `gitsha:${item.sha}`

// Dropbox: API provides content_hash
contentHash: `dropbox:${entry.id}:${entry.content_hash ?? entry.server_modified}`

// Confluence: version number increments on edit
contentHash: `confluence:${page.id}:${page.version.number}`
```

**Critical invariant:** The `contentHash` MUST be identical whether produced by `listDocuments` (stub) or `getDocument` (full doc). Both should use the same stub function to guarantee this.

### Implementation Pattern

```typescript
// 1. Create a stub function (sync, no API calls)
function fileToStub(file: ServiceFile): ExternalDocument {
  return {
    externalId: file.id,
    title: file.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://service.com/file/${file.id}`,
    contentHash: `service:${file.id}:${file.modifiedTime ?? ''}`,
    metadata: { /* fields needed by mapTags */ },
  }
}

// 2. listDocuments returns stubs (fast, metadata only)
listDocuments: async (accessToken, sourceConfig, cursor) => {
  const response = await fetchWithRetry(listUrl, { ... })
  const files = (await response.json()).files
  const documents = files.map(fileToStub)
  return { documents, nextCursor, hasMore }
}

// 3. getDocument fetches content and returns full doc with SAME contentHash
getDocument: async (accessToken, sourceConfig, externalId) => {
  const metadata = await fetchWithRetry(metadataUrl, { ... })
  const file = await metadata.json()
  if (file.trashed) return null

  try {
    const content = await fetchContent(accessToken, file)
    if (!content.trim()) return null
    const stub = fileToStub(file)
    return { ...stub, content, contentDeferred: false }
  } catch (error) {
    logger.warn(`Failed to fetch content for: ${file.name}`, { error })
    return null
  }
}
```

### Reference Implementations

- **Google Drive**: `connectors/google-drive/google-drive.ts` — file download/export with `modifiedTime` hash
- **GitHub**: `connectors/github/github.ts` — git blob SHA hash
- **Notion**: `connectors/notion/notion.ts` — blocks API with `last_edited_time` hash
- **Confluence**: `connectors/confluence/confluence.ts` — version number hash

## tagDefinitions — Declared Tag Definitions

Declare which tags the connector populates using semantic IDs. Shown in the add-connector modal as opt-out checkboxes.
On connector creation, slots are **dynamically assigned** via `getNextAvailableSlot` — connectors never hardcode slot names.

```typescript
tagDefinitions: [
  { id: 'labels', displayName: 'Labels', fieldType: 'text' },
  { id: 'version', displayName: 'Version', fieldType: 'number' },
  { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
],
```

Each entry has:
- `id`: Semantic key matching a key returned by `mapTags` (e.g. `'labels'`, `'version'`)
- `displayName`: Human-readable name shown in the UI (e.g. "Labels", "Last Modified")
- `fieldType`: `'text'` | `'number'` | `'date'` | `'boolean'` — determines which slot pool to draw from

Users can opt out of specific tags in the modal. Disabled IDs are stored in `sourceConfig.disabledTagIds`.
The assigned mapping (`semantic id → slot`) is stored in `sourceConfig.tagSlotMapping`.

## mapTags — Metadata to Semantic Keys

Maps source metadata to semantic tag keys. Required if `tagDefinitions` is set.
The sync engine calls this automatically and translates semantic keys to actual DB slots
using the `tagSlotMapping` stored on the connector.

Return keys must match the `id` values declared in `tagDefinitions`.

```typescript
mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {}

  // Validate arrays before casting — metadata may be malformed
  const labels = Array.isArray(metadata.labels) ? (metadata.labels as string[]) : []
  if (labels.length > 0) result.labels = labels.join(', ')

  // Validate numbers — guard against NaN
  if (metadata.version != null) {
    const num = Number(metadata.version)
    if (!Number.isNaN(num)) result.version = num
  }

  // Validate dates — guard against Invalid Date
  if (typeof metadata.lastModified === 'string') {
    const date = new Date(metadata.lastModified)
    if (!Number.isNaN(date.getTime())) result.lastModified = date
  }

  return result
}
```

## External API Calls — Use `fetchWithRetry`

All external API calls must use `fetchWithRetry` from `@/lib/knowledge/documents/utils` instead of raw `fetch()`. This provides exponential backoff with retries on 429/502/503/504 errors. It returns a standard `Response` — all `.ok`, `.json()`, `.text()` checks work unchanged.

For `validateConfig` (user-facing, called on save), pass `VALIDATE_RETRY_OPTIONS` to cap wait time at ~7s. Background operations (`listDocuments`, `getDocument`) use the built-in defaults (5 retries, ~31s max).

```typescript
import { VALIDATE_RETRY_OPTIONS, fetchWithRetry } from '@/lib/knowledge/documents/utils'

// Background sync — use defaults
const response = await fetchWithRetry(url, {
  method: 'GET',
  headers: { Authorization: `Bearer ${accessToken}` },
})

// validateConfig — tighter retry budget
const response = await fetchWithRetry(url, { ... }, VALIDATE_RETRY_OPTIONS)
```

## sourceUrl

If `ExternalDocument.sourceUrl` is set, the sync engine stores it on the document record. Always construct the full URL (not a relative path).

## Sync Engine Behavior (Do Not Modify)

The sync engine (`lib/knowledge/connectors/sync-engine.ts`) is connector-agnostic. It:
1. Calls `listDocuments` with pagination until `hasMore` is false
2. Compares `contentHash` to detect new/changed/unchanged documents
3. Stores `sourceUrl` and calls `mapTags` on insert/update automatically
4. Handles soft-delete of removed documents
5. Resolves access tokens automatically — OAuth tokens are refreshed, API keys are decrypted from the `encryptedApiKey` column

You never need to modify the sync engine when adding a connector.

## Icon

The `icon` field on `ConnectorConfig` is used throughout the UI — in the connector list, the add-connector modal, and as the document icon in the knowledge base table (replacing the generic file type icon for connector-sourced documents). The icon is read from `CONNECTOR_REGISTRY[connectorType].icon` at runtime — no separate icon map to maintain.

If the service already has an icon in `apps/sim/components/icons.tsx` (from a tool integration), reuse it. Otherwise, ask the user to provide the SVG.

## Registering

Add one line to `apps/sim/connectors/registry.ts`:

```typescript
import { {service}Connector } from '@/connectors/{service}'

export const CONNECTOR_REGISTRY: ConnectorRegistry = {
  // ... existing connectors ...
  {service}: {service}Connector,
}
```

## Reference Implementations

- **OAuth + contentDeferred**: `apps/sim/connectors/google-drive/google-drive.ts` — file download with metadata-based hash, `orderBy` for deterministic pagination
- **OAuth + contentDeferred (blocks API)**: `apps/sim/connectors/notion/notion.ts` — complex block content extraction deferred to `getDocument`
- **OAuth + contentDeferred (git)**: `apps/sim/connectors/github/github.ts` — blob SHA hash, tree listing
- **OAuth + inline content**: `apps/sim/connectors/confluence/confluence.ts` — multiple config field types, `mapTags`, label fetching
- **API key**: `apps/sim/connectors/fireflies/fireflies.ts` — GraphQL API with Bearer token auth

## Checklist

- [ ] Created `connectors/{service}/{service}.ts` with full ConnectorConfig
- [ ] Created `connectors/{service}/index.ts` barrel export
- [ ] **Auth configured correctly:**
  - OAuth: `auth.provider` matches an existing `OAuthService` in `lib/oauth/types.ts`
  - API key: `auth.label` and `auth.placeholder` set appropriately
- [ ] **Selector fields configured correctly (if applicable):**
  - Every `type: 'selector'` field has a canonical pair (`short-input` or `dropdown` with same `canonicalParamId` and `mode: 'advanced'`)
  - `required` is identical on both fields in each canonical pair
  - `selectorKey` exists in `hooks/selectors/registry.ts`
  - `dependsOn` references selector field IDs (not `canonicalParamId`)
  - Dependency `canonicalParamId` values exist in `SELECTOR_CONTEXT_FIELDS`
- [ ] `listDocuments` handles pagination with metadata-based content hashes
- [ ] `contentDeferred: true` used if content requires per-doc API calls (file download, export, blocks fetch)
- [ ] `contentHash` is metadata-based (not content-based) and identical between stub and `getDocument`
- [ ] `sourceUrl` set on each ExternalDocument (full URL, not relative)
- [ ] `metadata` includes source-specific data for tag mapping
- [ ] `tagDefinitions` declared for each semantic key returned by `mapTags`
- [ ] `mapTags` implemented if source has useful metadata (labels, dates, versions)
- [ ] `validateConfig` verifies the source is accessible
- [ ] All external API calls use `fetchWithRetry` (not raw `fetch`)
- [ ] All optional config fields validated in `validateConfig`
- [ ] Icon exists in `components/icons.tsx` (or asked user to provide SVG)
- [ ] Registered in `connectors/registry.ts`
