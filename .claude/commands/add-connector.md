---
description: Add a knowledge base connector for syncing documents from an external source
argument-hint: <service-name> [api-docs-url]
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
    // Paginate via cursor, extract text, compute SHA-256 hash
    // Return { documents: ExternalDocument[], nextCursor?, hasMore }
  },

  getDocument: async (accessToken, sourceConfig, externalId) => {
    // Return ExternalDocument or null
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

## ExternalDocument Shape

Every document returned from `listDocuments`/`getDocument` must include:

```typescript
{
  externalId: string          // Source-specific unique ID
  title: string               // Document title
  content: string             // Extracted plain text
  mimeType: 'text/plain'     // Always text/plain (content is extracted)
  contentHash: string         // SHA-256 of content (change detection)
  sourceUrl?: string          // Link back to original (stored on document record)
  metadata?: Record<string, unknown>  // Source-specific data (fed to mapTags)
}
```

## Content Hashing (Required)

The sync engine uses content hashes for change detection:

```typescript
async function computeContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}
```

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

- **OAuth**: `apps/sim/connectors/confluence/confluence.ts` — multiple config field types, `mapTags`, label fetching
- **API key**: `apps/sim/connectors/fireflies/fireflies.ts` — GraphQL API with Bearer token auth

## Checklist

- [ ] Created `connectors/{service}/{service}.ts` with full ConnectorConfig
- [ ] Created `connectors/{service}/index.ts` barrel export
- [ ] **Auth configured correctly:**
  - OAuth: `auth.provider` matches an existing `OAuthService` in `lib/oauth/types.ts`
  - API key: `auth.label` and `auth.placeholder` set appropriately
- [ ] `listDocuments` handles pagination and computes content hashes
- [ ] `sourceUrl` set on each ExternalDocument (full URL, not relative)
- [ ] `metadata` includes source-specific data for tag mapping
- [ ] `tagDefinitions` declared for each semantic key returned by `mapTags`
- [ ] `mapTags` implemented if source has useful metadata (labels, dates, versions)
- [ ] `validateConfig` verifies the source is accessible
- [ ] All external API calls use `fetchWithRetry` (not raw `fetch`)
- [ ] All optional config fields validated in `validateConfig`
- [ ] Icon exists in `components/icons.tsx` (or asked user to provide SVG)
- [ ] Registered in `connectors/registry.ts`
