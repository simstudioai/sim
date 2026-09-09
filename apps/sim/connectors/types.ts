import type { MirroredDocumentAcl } from '@/lib/knowledge/access/types'
import type { OAuthService } from '@/lib/oauth/types'
import type { SelectorKey } from '@/lib/selectors/manifest'

/**
 * Authentication configuration for a connector.
 * OAuth connectors reuse the existing credential system.
 * API key connectors store an encrypted key in the `encryptedApiKey` column.
 */
export type ConnectorAuthConfig =
  | {
      mode: 'oauth'
      provider: OAuthService
      requiredScopes?: string[]
      /** Restricts permission-mirroring crawls when ordinary OAuth cannot grant directory access. */
      adminCredentialType?: 'service_account'
      /** Optional token authentication for workspace crawls; member access always uses OAuth. */
      apiKey?: { label: string; placeholder?: string }
      /**
       * Scopes to mint with when the connector's credential is a service
       * account rather than a person's OAuth account.
       *
       * A service account authorizes through a signed JWT that names its own
       * scopes, so it has no granted-scope list to inherit from
       * {@link requiredScopes} — that set describes an interactive consent
       * screen, and a provider may accept scopes there that it refuses in a
       * two-legged grant. Defaults to `requiredScopes` where the two sets
       * genuinely coincide, which is the common case.
       */
      serviceAccountScopes?: string[]
      /**
       * The config field naming the person a service-account credential acts
       * as, through domain-wide delegation.
       *
       * The subject belongs to the connector, not the credential. One
       * `google-service-account` credential matches every Google service, so a
       * subject stored on it would silently apply to a workflow reading that
       * person's mail as well as to this crawl reading their Drive.
       */
      serviceAccountSubjectFieldId?: string
    }
  | {
      mode: 'apiKey'
      label?: string
      placeholder?: string
      /**
       * When true, the key may be left blank — the source is reachable without
       * authentication (e.g. a public documentation site). A blank key is
       * stored as `null` rather than an encrypted empty string, and the
       * connector receives an empty access token.
       */
      optional?: boolean
    }

/** A group in an external directory, named as the connector's ACLs name it. */
export interface ConnectorDirectoryGroup {
  /** The identifier a `g:` token carries — a group email, a group id. */
  id: string
}

export interface ConnectorDirectoryMembership {
  group: ConnectorDirectoryGroup
  /** Canonical u:email or provider-attested s: identity tokens, with nested groups flattened. */
  memberTokens: string[]
  /**
   * False when the walk could not be completed. A partial membership must never
   * replace a stored one: cutting a group down to the part that happened to
   * enumerate silently revokes everyone in the part that did not.
   */
  complete: boolean
}

/**
 * One directory, opened for the length of a sync. Implementations throw rather
 * than returning a partial listing — a truncated directory read as complete
 * would delete every group past the cut-off.
 */
export interface ConnectorDirectory {
  /**
   * The provider segment of every group token this directory's groups produce
   * — the same constant the connector's ACL mapper writes, so a stored token
   * and the group row it names can never spell the provider differently.
   */
  providerId: string
  /** The tenant segment of every group token this directory's groups produce. */
  tenantId: string
  listGroups: () => Promise<ConnectorDirectoryGroup[]>
  listGroupMembers: (group: ConnectorDirectoryGroup) => Promise<ConnectorDirectoryMembership>
}

/**
 * A single document fetched from an external source.
 */
export interface ExternalDocument {
  /** Source-specific unique ID (page ID, file ID) */
  externalId: string
  /** Document title / filename */
  title: string
  /** Extracted text content. Empty when {@link ExternalDocument.sourceFile} carries the document instead. */
  content: string
  /** MIME type of the content */
  mimeType: string
  /**
   * The source file itself, for connectors that hand over the original document
   * rather than text they extracted from it.
   *
   * Preferred for any format the knowledge base can parse. Extracting inside a
   * connector strands the document on a second, weaker parser: the shared
   * pipeline routes PDFs to OCR (so scanned pages are readable at all) and owns
   * every other format's parser, while a connector doing its own extraction
   * stores plain text that no longer declares what it came from.
   *
   * Carried as one object so the bytes can never disagree with the name and type
   * that describe them.
   */
  sourceFile?: {
    bytes: Buffer
    /** Name whose extension names the format, e.g. `Report.pdf`. */
    fileName: string
    mimeType: string
  }
  /** Link back to the original document */
  sourceUrl?: string
  /** Hash of content for change detection (format varies by connector) */
  contentHash: string
  /**
   * Connector-owned hash to persist for a skipped hydration that must be retried
   * even when the source's listing metadata is unchanged.
   */
  skippedRetryContentHash?: string
  /**
   * Listing policy for a previously skipped, content-less document. Opt in only
   * when the listing hash changes whenever a verified skip can become indexable.
   * Source failures (null hashes) and explicit rehydration always retry.
   */
  skippedRetryPolicy?: 'source-change'
  /** When true, content is empty and will be fetched via getDocument for new/changed docs only */
  contentDeferred?: boolean
  /**
   * How large the deferred content is expected to be, in bytes, when the
   * listing cannot know exactly. Bounds how many deferred documents hydrate
   * at once: without it a deferred document is assumed to be as large as the
   * whole in-flight budget and hydrates alone, which turns a mailbox crawl
   * into one thread at a time.
   */
  estimatedBytes?: number
  /**
   * When set, the document was intentionally not indexed (e.g. it exceeds the
   * connector's size limit). The sync engine records it as a `failed` document
   * carrying this reason so it is visible in the knowledge base UI instead of
   * being silently dropped.
   */
  skippedReason?: string
  /**
   * Controls what happens when a previously indexed document is intentionally
   * skipped. The default retains its last-known-good content; `replace` removes
   * stale indexed content and persists the skipped state as authoritative.
   */
  skippedExistingDisposition?: 'replace'
  /**
   * Who may read this document, mirrored from the source's own permissions.
   * Only meaningful for a connector whose meta sets
   * {@link ConnectorMeta.mirrorsSourceAcls}, and only used by an admin-mode
   * crawl; every other mode derives access some other way and ignores it.
   *
   * Deliberately applied by a pass of its own rather than by the write that
   * stores the document. A document whose content is unchanged is never
   * written at all, and a permission change with no content change is the
   * common case — so an ACL that rode along with the content write would only
   * ever land for documents that happened to be edited.
   */
  acl?: MirroredDocumentAcl
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
  /**
   * Whether absence from this listing is authoritative enough for deletion
   * reconciliation. Defaults to true. Offset-based or otherwise unstable
   * provider pagination must set this to false.
   */
  reconciliationSafe?: boolean
}

/**
 * One entry of a connector's change feed. A removal is authoritative for the
 * caller: the item was deleted, or their account can no longer reach it.
 */
export type ExternalChange =
  | { kind: 'upsert'; externalId: string; document: ExternalDocument }
  | { kind: 'removed'; externalId: string }

export interface ExternalChangeList {
  changes: ExternalChange[]
  /**
   * The cursor to continue from: the next page while `hasMore`, otherwise the
   * point the drained feed should resume from on the next read.
   */
  nextCursor: string
  hasMore: boolean
}

export const SYNC_SKIP_REASONS = [
  'connector_unavailable',
  'knowledge_base_deleted',
  'connector_not_syncable',
  'dispatch_superseded',
  'sync_in_progress',
  'sync_superseded',
  'connector_deleted_during_sync',
] as const

export type SyncSkipReason = (typeof SYNC_SKIP_REASONS)[number]

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  docsAdded: number
  docsUpdated: number
  docsDeleted: number
  docsUnchanged: number
  /** Source documents intentionally recorded without indexing, such as oversized files. */
  docsSkipped: number
  /** Source documents that failed during listing, hydration, or persistence. */
  docsFailed: number
  /** Immediate hand-off outcome; eventual child results live on document rows and child runs. */
  processingDispatch: {
    requested: number
    accepted: number
    failed: number
  }
  /** Expected queue, lifecycle, or lock no-op. Never derived from error text. */
  skipReason?: SyncSkipReason
  /** The listing or reconciliation has more durable work, or the source was non-authoritative. */
  listingIncomplete?: boolean
  /** Diagnostic for an actual failed sync. */
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
  /** Required when an administrator account supplies documents and source permissions. */
  requiredInAdminMode?: true
  /** Secondary Search setup controls, shown in the shared More options disclosure. */
  setupGroup?: 'options'
  description?: string
  /** Excludes settings unused by member crawls and account-local selectors that need a manual sibling. */
  hideInMemberMode?: true
  options?: { label: string; id: string }[]

  /** Selector key from the selector registry (used when type is 'selector') */
  selectorKey?: SelectorKey
  /** MIME type filter passed to the selector context (e.g. limit a Google Drive picker to folders) */
  mimeType?: string
  /** Field IDs this field depends on — clears when deps change */
  dependsOn?: string[] | { all?: string[]; any?: string[] }

  /** Display mode for canonical pair fields ('basic' for selector, 'advanced' for manual input) */
  mode?: 'basic' | 'advanced'
  /** Links selector + manual input fields that resolve to the same config key */
  canonicalParamId?: string

  /**
   * When true, the field accepts multiple values.
   * - For `selector` fields, renders the picker in multi-select mode and persists `string[]` to sourceConfig.
   * - For `short-input` fields, accepts a comma-separated list and persists `string[]` to sourceConfig.
   * Connector handlers receive `string | string[]` and should normalize via `parseMultiValue`.
   */
  multi?: boolean
}

/**
 * Client-safe declarative metadata for a knowledge source connector.
 *
 * This is the half of a connector that the add-connector UI needs (name, icon,
 * auth, config fields). It intentionally contains no runtime fetch functions, so
 * it never pulls server-only code (e.g. `input-validation.server`, `undici`) into
 * the client bundle. Each connector exports its meta from a sibling `meta.ts`,
 * mirroring the `XBlockMeta` pattern in `blocks/`.
 */
export interface ConnectorMeta {
  /** Opts a source into workspace Search after its indexing and permission paths are verified. */
  search?: true
  /** Source setup guide shown only in Search connection flows. */
  searchDocsUrl?: string
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
   * Whether this connector's extracted content can change without the source item's
   * own change-detection hash changing — e.g. a Confluence page that transcludes
   * another page via the Include Page / Excerpt macro: editing the included page
   * changes the container's rendered `view` output without bumping the container's
   * version, so its version-based `contentHash` stays identical.
   *
   * Incremental syncs remain hash-gated (cheap). On an explicit **full resync**
   * (`fullSync`), the engine re-hydrates and re-indexes these connectors' documents
   * even when their hash is unchanged, so transcluded/rendered-dependency changes are
   * picked up. Only the deliberate full resync pays this re-index cost.
   */
  rehydrateOnFullSync?: boolean

  /**
   * Tag definitions this connector populates. Shown in the add-connector modal
   * as opt-out checkboxes. On connector creation, tag definitions are auto-created
   * on the KB for enabled slots, and mapTags output is filtered to only include them.
   */
  tagDefinitions?: ConnectorTagDefinition[]

  /**
   * Set when a listing under one person's own token returns exactly the documents
   * that person may read, so a knowledge base can crawl the source once per
   * enrolled member and take each member's listing as that member's access.
   * Names the config fields that cap the listing: a cap would hide part of a
   * member's corpus and suppress removals forever, so those fields are refused
   * whenever the connector crawls per member.
   */
  permissionScopedListing?: { capFieldIds: readonly string[] }

  /**
   * One dedicated credential may supply content while member credentials only
   * establish visibility. Every credential must use the same external document
   * identity, and the indexed body must not contain credential-specific content.
   */
  supportsSeparateContentCredential?: true

  /**
   * Set when the connector's listing reports each document's own permissions,
   * so one crawl under an administrative credential can mirror the source's
   * access model instead of asking every person to connect their own account.
   *
   * The connector answers for every document it lists — changed or not, since
   * the ACL pass reads the whole listing — either by filling
   * {@link ExternalDocument.acl} inline or through
   * {@link ConnectorConfig.getDocumentAcls}, using the token vocabulary in
   * `lib/knowledge/access/tokens`. A document it lists without an ACL is
   * readable by nobody, so a connector must set this only where it can speak
   * for every document it returns.
   */
  mirrorsSourceAcls?: true
  /** Provider prerequisites shown when an administrator configures permission-aware indexing. */
  adminSetupHint?: string
  /** Mirrored ACLs identify people by their own verified OAuth subject instead of email. */
  requiresMemberIdentity?: true
}

/**
 * Full server-side connector definition: client-safe {@link ConnectorMeta} plus
 * the runtime functions for fetching data. Lives in the connector's main module
 * alongside the metadata it spreads in.
 *
 * Mirrors ToolConfig/TriggerConfig pattern:
 * - Purely declarative metadata (via {@link ConnectorMeta})
 * - Runtime functions for data fetching (listDocuments, getDocument, validateConfig)
 *
 * Adding a new connector = creating one of these + registering it.
 */
export interface ConnectorConfig extends ConnectorMeta {
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

  /**
   * Validate that sourceConfig is correct and accessible (called on save).
   * `syncContext` is seeded the same way a run's is, so a connector that
   * reads its site from the credential need not rediscover it here.
   */
  validateConfig: (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
  ) => Promise<{ valid: boolean; error?: string }>

  /**
   * Whether a listing failure means the caller simply cannot reach the
   * configured scope — the folder or space is not shared with them. A
   * members-mode crawl treats that as a complete listing of nothing for that
   * member rather than an error, so their access is withdrawn instead of
   * retried forever. Only meaningful alongside {@link ConnectorMeta.permissionScopedListing}.
   */
  isListingScopeUnavailableError?: (error: unknown) => boolean

  /** Explicit provider rejection of the credential itself, rather than a scope or transient failure. */
  isCredentialInvalidError?: (error: unknown) => boolean

  /**
   * Opens a change feed over the caller's view of the source: the cursor from
   * which {@link listChanges} later reports everything they gain, lose, or see
   * modified. A members-mode crawl takes it before a full listing so nothing
   * that changes during the listing is missed, and then reads the feed on
   * every run instead of relisting. Only meaningful alongside
   * {@link ConnectorMeta.permissionScopedListing}.
   */
  getChangeCursor?: (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
  ) => Promise<string>

  /** Whether the change feed completely represents the configured source scope. */
  supportsChangeFeed?: (sourceConfig: Record<string, unknown>) => boolean

  /**
   * Reads the change feed from a cursor. An upsert carries the same stub a
   * listing would; a removal withdraws the caller's access to the item.
   */
  listChanges?: (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor: string,
    syncContext?: Record<string, unknown>
  ) => Promise<ExternalChangeList>

  /**
   * Whether a change-feed failure means the cursor has expired, so the feed
   * must be reopened from a fresh full listing rather than retried.
   */
  isChangeCursorInvalidError?: (error: unknown) => boolean
  /** Whether a saved full-listing cursor expired and must restart from a new generation. */
  isListingCursorInvalidError?: (error: unknown) => boolean

  /**
   * Opens the external directory whose groups this connector's mirrored ACLs
   * refer to, or null when it has none reachable.
   *
   * The connector owns this because only it knows what a tenant is for its
   * source — a Workspace domain for Drive, a site's cloud id for Confluence —
   * and the tenant is baked into every stored group token, so a wrong guess
   * orphans every ACL already written. It also owns the enumeration, so the
   * sync orchestration stays provider-agnostic.
   * Permission data must be fetched lazily by listGroups/listGroupMembers,
   * after the caller acquires the shared directory lease. Opening may resolve
   * tenant identity but must not cache a permission snapshot from before it.
   */
  openDirectory?: (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
  ) => Promise<ConnectorDirectory | null>

  /**
   * The ACLs of listed documents the listing itself could not answer for.
   *
   * Called with exactly the documents whose {@link ExternalDocument.acl} the
   * listing left unset, after the listing and once for all of them, so the
   * round trips are bounded by what the listing could not carry rather than by
   * the page size. The documents come with their listing metadata, which is
   * where a connector keeps what the permission lookup needs — the space a
   * page lives in, whether it is a page or a blog post. Drive fills the ACL
   * inline for most files and lands here only for the ones its listing cannot
   * describe — a shared drive's files, whose permissions Drive serves solely
   * through `permissions.list`. Confluence carries none inline, so every page
   * lands here.
   *
   * Returns tokens per external id. A document the connector omits is readable
   * by nobody: a connector declaring {@link ConnectorMeta.mirrorsSourceAcls}
   * promises an answer for every document it listed, and one whose permissions
   * it could not read this run is omitted rather than guessed at.
   */
  getDocumentAcls?: (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    documents: readonly ExternalDocument[],
    syncContext?: Record<string, unknown>
  ) => Promise<Record<string, MirroredDocumentAcl>>

  /** Map source metadata to semantic tag keys (translated to slots by the sync engine) */
  mapTags?: (metadata: Record<string, unknown>) => Record<string, unknown>
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

/**
 * Registry mapping connector IDs to their client-safe metadata. Backs the
 * add-connector UI without pulling server-only runtime code into the client
 * bundle. See `@/connectors/registry`.
 */
export interface ConnectorMetaRegistry {
  [connectorId: string]: ConnectorMeta
}
