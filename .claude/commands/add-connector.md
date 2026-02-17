---
description: Add a knowledge base connector for syncing documents from an external source
argument-hint: <service-name> [api-docs-url]
---

# Add Connector Skill

You are an expert at adding knowledge base connectors to Sim. A connector syncs documents from an external source (Confluence, Google Drive, Notion, etc.) into a knowledge base.

## Your Task

When the user asks you to create a connector:
1. Use Context7 or WebFetch to read the service's API documentation
2. Create the connector directory and config
3. Register it in the connector registry

## Directory Structure

Create files in `apps/sim/connectors/{service}/`:
```
connectors/{service}/
├── index.ts          # Barrel export
└── {service}.ts      # ConnectorConfig definition
```

## ConnectorConfig Structure

```typescript
import { createLogger } from '@sim/logger'
import { {Service}Icon } from '@/components/icons'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'

const logger = createLogger('{Service}Connector')

export const {service}Connector: ConnectorConfig = {
  id: '{service}',
  name: '{Service}',
  description: 'Sync documents from {Service} into your knowledge base',
  version: '1.0.0',
  icon: {Service}Icon,

  oauth: {
    required: true,
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

## sourceUrl

If `ExternalDocument.sourceUrl` is set, the sync engine stores it on the document record. Always construct the full URL (not a relative path).

## Sync Engine Behavior (Do Not Modify)

The sync engine (`lib/knowledge/connectors/sync-engine.ts`) is connector-agnostic. It:
1. Calls `listDocuments` with pagination until `hasMore` is false
2. Compares `contentHash` to detect new/changed/unchanged documents
3. Stores `sourceUrl` and calls `mapTags` on insert/update automatically
4. Handles soft-delete of removed documents

You never need to modify the sync engine when adding a connector.

## OAuth Credential Reuse

Connectors reuse the existing OAuth infrastructure. The `oauth.provider` must match an `OAuthService` from `apps/sim/lib/oauth/types.ts`. Check existing providers before adding a new one.

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

## Reference Implementation

See `apps/sim/connectors/confluence/confluence.ts` for a complete example with:
- Multiple config field types (text + dropdown)
- Label fetching and CQL search filtering
- Blogpost + page content types
- `mapTags` mapping labels, version, and dates to semantic keys

## Checklist

- [ ] Created `connectors/{service}/{service}.ts` with full ConnectorConfig
- [ ] Created `connectors/{service}/index.ts` barrel export
- [ ] `oauth.provider` matches an existing OAuthService in `lib/oauth/types.ts`
- [ ] `listDocuments` handles pagination and computes content hashes
- [ ] `sourceUrl` set on each ExternalDocument (full URL, not relative)
- [ ] `metadata` includes source-specific data for tag mapping
- [ ] `tagDefinitions` declared for each semantic key returned by `mapTags`
- [ ] `mapTags` implemented if source has useful metadata (labels, dates, versions)
- [ ] `validateConfig` verifies the source is accessible
- [ ] All optional config fields validated in `validateConfig`
- [ ] Icon exists in `components/icons.tsx` (or asked user to provide SVG)
- [ ] Registered in `connectors/registry.ts`
