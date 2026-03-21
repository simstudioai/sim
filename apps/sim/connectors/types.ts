import type { OAuthService } from '@/lib/oauth/types'
import type { SelectorKey } from '@/hooks/selectors/types'

/**
 * Authentication configuration for a connector.
 * OAuth connectors reuse the existing credential system.
 * API key connectors store an encrypted key in the `encryptedApiKey` column.
 */
export type ConnectorAuthConfig =
  | { mode: 'oauth'; provider: OAuthService; requiredScopes?: string[] }
  | { mode: 'apiKey'; label?: string; placeholder?: string }

/**
 * A single document fetched from an external source.
 */
export interface ExternalDocument {
  /** Source-specific unique ID (page ID, file ID) */
  externalId: string
  /** Document title / filename */
  title: string
  /** Extracted text content */
  content: string
  /** MIME type of the content */
  mimeType: string
  /** Link back to the original document */
  sourceUrl?: string
  /** Hash of content for change detection (format varies by connector) */
  contentHash: string
  /** When true, content is empty and will be fetched via getDocument for new/changed docs only */
  contentDeferred?: boolean
  /** Additional source-specific metadata */
  metadata?: Record<string, unknown>
}

/**
 * Paginated result from listing documents in an external source.
 */
export interface ExternalDocumentList {
  documents: ExternalDocument[]
  nextCursor?: string
  hasMore: boolean
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  docsAdded: number
  docsUpdated: number
  docsDeleted: number
  docsUnchanged: number
  docsFailed: number
  error?: string
}

/**
 * Config field for source-specific settings (rendered in the add-connector UI).
 */
export interface ConnectorConfigField {
  id: string
  title: string
  type: 'short-input' | 'dropdown' | 'selector'
  placeholder?: string
  required?: boolean
  description?: string
  options?: { label: string; id: string }[]

  /** Selector key from the selector registry (used when type is 'selector') */
  selectorKey?: SelectorKey
  /** Field IDs this field depends on — clears when deps change */
  dependsOn?: string[] | { all?: string[]; any?: string[] }

  /** Display mode for canonical pair fields ('basic' for selector, 'advanced' for manual input) */
  mode?: 'basic' | 'advanced'
  /** Links selector + manual input fields that resolve to the same config key */
  canonicalParamId?: string
}

/**
 * Declarative config for a knowledge source connector.
 *
 * Mirrors ToolConfig/TriggerConfig pattern:
 * - Purely declarative metadata (id, name, icon, oauth, configFields)
 * - Runtime functions for data fetching (listDocuments, getDocument, validateConfig)
 *
 * Adding a new connector = creating one of these + registering it.
 */
export interface ConnectorConfig {
  /** Unique connector identifier, e.g. 'confluence', 'google_drive', 'notion' */
  id: string
  /** Human-readable name, e.g. 'Confluence', 'Google Drive' */
  name: string
  /** Short description of the connector */
  description: string
  /** Semver version */
  version: string
  /** Icon component for the connector */
  icon: React.ComponentType<{ className?: string }>

  /** Authentication configuration */
  auth: ConnectorAuthConfig

  /** Source configuration fields rendered in the add-connector UI */
  configFields: ConnectorConfigField[]

  /**
   * Whether this connector supports incremental sync (only fetching changes since last sync).
   * When true, the sync engine passes `lastSyncAt` to `listDocuments` so the connector
   * can filter to only changed documents. Connectors without this flag always do full syncs.
   */
  supportsIncrementalSync?: boolean

  /**
   * List all documents from the configured source (handles pagination via cursor).
   * syncContext is a mutable object shared across all pages of a single sync run —
   * connectors can use it to cache expensive lookups (e.g. schema fetches) without
   * leaking state into module-level globals.
   * lastSyncAt is provided when incremental sync is active — connectors should only
   * return documents modified after this timestamp.
   */
  listDocuments: (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ) => Promise<ExternalDocumentList>

  /**
   * Fetch a single document by its external ID.
   * syncContext is an optional mutable object for caching expensive lookups
   * (e.g. tag maps, notebook lists) across multiple getDocument calls.
   */
  getDocument: (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ) => Promise<ExternalDocument | null>

  /** Validate that sourceConfig is correct and accessible (called on save) */
  validateConfig: (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ) => Promise<{ valid: boolean; error?: string }>

  /** Map source metadata to semantic tag keys (translated to slots by the sync engine) */
  mapTags?: (metadata: Record<string, unknown>) => Record<string, unknown>

  /**
   * Tag definitions this connector populates. Shown in the add-connector modal
   * as opt-out checkboxes. On connector creation, tag definitions are auto-created
   * on the KB for enabled slots, and mapTags output is filtered to only include them.
   */
  tagDefinitions?: ConnectorTagDefinition[]
}

/**
 * A tag that a connector populates, with a semantic ID and human-readable name.
 * Slots are dynamically assigned on connector creation via getNextAvailableSlot.
 */
export interface ConnectorTagDefinition {
  /** Semantic ID matching a key returned by mapTags (e.g. 'labels', 'version') */
  id: string
  /** Human-readable name shown in UI (e.g. 'Labels', 'Last Modified') */
  displayName: string
  /** Field type determines which slot pool to draw from */
  fieldType: 'text' | 'number' | 'date' | 'boolean'
}

/**
 * Tag slots available on the document table for connector metadata mapping.
 */
export interface DocumentTags {
  tag1?: string
  tag2?: string
  tag3?: string
  tag4?: string
  tag5?: string
  tag6?: string
  tag7?: string
  number1?: number
  number2?: number
  number3?: number
  number4?: number
  number5?: number
  date1?: Date
  date2?: Date
  boolean1?: boolean
  boolean2?: boolean
  boolean3?: boolean
}

/**
 * Registry mapping connector IDs to their configs.
 */
export interface ConnectorRegistry {
  [connectorId: string]: ConnectorConfig
}
