import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  fetchWithRetry,
  type RetryOptions,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { googleVaultConnectorMeta } from '@/connectors/google-vault/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, parseTagDate, takeIndexableWithinCap } from '@/connectors/utils'

const logger = createLogger('GoogleVaultConnector')

const VAULT_API_BASE = 'https://vault.googleapis.com/v1'

/**
 * Vault documents a maximum of 100 for `matters.list` and `matters.holds.list`.
 * `matters.savedQueries.list` documents no bound at all, so it reuses the same
 * value rather than assuming a larger one is honored.
 */
const PAGE_SIZE = 100

/**
 * Matters whose child resources are enumerated in a single `listDocuments` call.
 *
 * The sync engine allows a bounded number of `listDocuments` calls per run, so
 * spending one call per matter per child kind would truncate the listing after a
 * few hundred matters. Draining a batch of matters per call keeps the call count
 * proportional to `matters / BATCH` instead of `matters × kinds`.
 */
const CHILD_MATTER_BATCH = 8

/** Concurrent child listings issued within one batch. */
const CHILD_CONCURRENCY = 4

/**
 * Upper bound on child pages drained for a single matter/kind pair. Vault returns at
 * most 100 children per page, so this covers 5,000 holds or saved queries in one
 * matter; exceeding it marks the listing capped rather than looping unbounded.
 */
const MAX_CHILD_PAGES = 50

/**
 * Google Vault matter, as returned by `matters.list`/`matters.get` with `view=FULL`.
 * @see https://developers.google.com/workspace/vault/reference/rest/v1/matters
 */
interface VaultMatter {
  matterId?: string
  name?: string
  description?: string
  state?: string
  matterRegion?: string
  matterPermissions?: { accountId?: string; role?: string }[]
}

/** Held account entry on a hold (`matters.holds` with `view=FULL_HOLD`). */
interface VaultHeldAccount {
  accountId?: string
  email?: string
  firstName?: string
  lastName?: string
  holdTime?: string
}

/** Service-specific query options attached to a hold. */
interface VaultCorpusQuery {
  driveQuery?: { includeSharedDriveFiles?: boolean }
  mailQuery?: { terms?: string; startTime?: string; endTime?: string }
  groupsQuery?: { terms?: string; startTime?: string; endTime?: string }
  hangoutsChatQuery?: { includeRooms?: boolean }
  voiceQuery?: { coveredData?: string[] }
}

/**
 * Google Vault hold.
 * @see https://developers.google.com/workspace/vault/reference/rest/v1/matters.holds
 */
interface VaultHold {
  holdId?: string
  name?: string
  corpus?: string
  updateTime?: string
  orgUnit?: { orgUnitId?: string; holdTime?: string }
  accounts?: VaultHeldAccount[]
  query?: VaultCorpusQuery
}

/**
 * Search parameters shared by saved queries and exports.
 * @see https://developers.google.com/workspace/vault/reference/rest/v1/Query
 */
interface VaultQuery {
  corpus?: string
  dataScope?: string
  method?: string
  searchMethod?: string
  terms?: string
  startTime?: string
  endTime?: string
  timeZone?: string
  accountInfo?: { emails?: string[] }
  orgUnitInfo?: { orgUnitId?: string }
  sharedDriveInfo?: { sharedDriveIds?: string[] }
  teamDriveInfo?: { teamDriveIds?: string[] }
  hangoutsChatInfo?: { roomId?: string[] }
  sitesUrlInfo?: { urls?: string[] }
  driveDocumentInfo?: { documentIds?: { ids?: string[] } }
}

/**
 * Google Vault saved query.
 * @see https://developers.google.com/workspace/vault/reference/rest/v1/matters.savedQueries
 */
interface VaultSavedQuery {
  savedQueryId?: string
  displayName?: string
  matterId?: string
  createTime?: string
  query?: VaultQuery
}

/** Child resource families enumerated under each matter. */
type VaultChildKind = 'holds' | 'savedQueries'

/**
 * Opaque pagination state for a Vault sync.
 *
 * A single sync interleaves two levels of pagination: a page of matters, then the
 * child resources of every matter on that page. The cursor carries the matter IDs of
 * the current page so a resumed call never has to re-derive them.
 *
 * Child pagination is fully drained inside one call per batch of matters, so the
 * cursor only has to remember how far through the matter page it has walked.
 */
interface VaultCursor {
  phase: 'matters' | 'children'
  /** Page token used to fetch the matters page processed in the `matters` phase. */
  mattersPageToken?: string
  /** Page token for the matters page that follows the one currently being walked. */
  nextMattersPageToken?: string
  matterIds?: string[]
  /** Index into `matterIds` of the first matter in the next batch to process. */
  matterIndex?: number
}

function encodeCursor(cursor: VaultCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(cursor?: string): VaultCursor {
  if (!cursor) return { phase: 'matters' }
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as VaultCursor
  } catch {
    return { phase: 'matters' }
  }
}

function readString(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : undefined
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  const text = readString(value)?.toLowerCase()
  if (text === 'true') return true
  if (text === 'false') return false
  return fallback
}

/** Parses a positive integer cap; `0` means unlimited. */
function readMaxDocuments(value: unknown): number {
  const text = readString(value)
  if (!text) return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function enabledChildKinds(sourceConfig: Record<string, unknown>): VaultChildKind[] {
  const kinds: VaultChildKind[] = []
  if (readBoolean(sourceConfig.includeHolds, true)) kinds.push('holds')
  if (readBoolean(sourceConfig.includeSavedQueries, true)) kinds.push('savedQueries')
  return kinds
}

async function vaultGet(
  accessToken: string,
  url: string,
  label: string,
  retryOptions?: RetryOptions
): Promise<Response> {
  return fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  ).catch((error) => {
    throw new Error(`Failed to reach Google Vault (${label}): ${toError(error).message}`)
  })
}

function appendLine(lines: string[], label: string, value?: string): void {
  if (value?.trim()) lines.push(`${label}: ${value.trim()}`)
}

/** Renders a matter as indexable plain text. */
function renderMatter(matter: VaultMatter): string {
  const lines: string[] = []
  appendLine(lines, 'Matter', matter.name)
  appendLine(lines, 'Matter ID', matter.matterId)
  appendLine(lines, 'State', matter.state)
  appendLine(lines, 'Region', matter.matterRegion)
  appendLine(lines, 'Description', matter.description)

  const permissions = (matter.matterPermissions ?? [])
    .map((permission) =>
      [permission.accountId, permission.role].filter((part) => Boolean(part)).join(' — ')
    )
    .filter((entry) => entry.length > 0)
  if (permissions.length > 0) {
    lines.push('Permissions:')
    for (const permission of permissions) lines.push(`  - ${permission}`)
  }

  return lines.join('\n')
}

/** Renders a hold, including its scope and search refinements, as plain text. */
function renderHold(hold: VaultHold, matterId: string): string {
  const lines: string[] = []
  appendLine(lines, 'Hold', hold.name)
  appendLine(lines, 'Hold ID', hold.holdId)
  appendLine(lines, 'Matter ID', matterId)
  appendLine(lines, 'Corpus', hold.corpus)
  appendLine(lines, 'Last updated', hold.updateTime)
  appendLine(lines, 'Organizational unit', hold.orgUnit?.orgUnitId)

  const accounts = (hold.accounts ?? [])
    .map((account) => {
      const name = [account.firstName, account.lastName].filter(Boolean).join(' ')
      return [account.email ?? account.accountId, name].filter(Boolean).join(' — ')
    })
    .filter((entry) => entry.length > 0)
  if (accounts.length > 0) {
    lines.push('Held accounts:')
    for (const account of accounts) lines.push(`  - ${account}`)
  }

  const mailLike = hold.query?.mailQuery ?? hold.query?.groupsQuery
  appendLine(lines, 'Search terms', mailLike?.terms)
  appendLine(lines, 'Start time', mailLike?.startTime)
  appendLine(lines, 'End time', mailLike?.endTime)
  if (hold.query?.driveQuery?.includeSharedDriveFiles !== undefined) {
    appendLine(
      lines,
      'Includes shared drive files',
      String(hold.query.driveQuery.includeSharedDriveFiles)
    )
  }
  if (hold.query?.hangoutsChatQuery?.includeRooms !== undefined) {
    appendLine(lines, 'Includes chat spaces', String(hold.query.hangoutsChatQuery.includeRooms))
  }
  const coveredData = hold.query?.voiceQuery?.coveredData
  if (coveredData && coveredData.length > 0) {
    appendLine(lines, 'Covered Voice data', coveredData.join(', '))
  }

  return lines.join('\n')
}

/** Renders a saved query and its search parameters as plain text. */
function renderSavedQuery(savedQuery: VaultSavedQuery, matterId: string): string {
  const lines: string[] = []
  appendLine(lines, 'Saved query', savedQuery.displayName)
  appendLine(lines, 'Saved query ID', savedQuery.savedQueryId)
  appendLine(lines, 'Matter ID', matterId)
  appendLine(lines, 'Created', savedQuery.createTime)

  const query = savedQuery.query
  appendLine(lines, 'Corpus', query?.corpus)
  appendLine(lines, 'Data scope', query?.dataScope)
  appendLine(lines, 'Search method', query?.method ?? query?.searchMethod)
  appendLine(lines, 'Search terms', query?.terms)
  appendLine(lines, 'Start time', query?.startTime)
  appendLine(lines, 'End time', query?.endTime)
  appendLine(lines, 'Time zone', query?.timeZone)
  appendLine(lines, 'Accounts', query?.accountInfo?.emails?.join(', '))
  appendLine(lines, 'Organizational unit', query?.orgUnitInfo?.orgUnitId)
  appendLine(
    lines,
    'Shared drives',
    (query?.sharedDriveInfo?.sharedDriveIds ?? query?.teamDriveInfo?.teamDriveIds)?.join(', ')
  )
  appendLine(lines, 'Chat spaces', query?.hangoutsChatInfo?.roomId?.join(', '))
  appendLine(lines, 'Site URLs', query?.sitesUrlInfo?.urls?.join(', '))
  appendLine(lines, 'Drive documents', query?.driveDocumentInfo?.documentIds?.ids?.join(', '))

  return lines.join('\n')
}

/**
 * Builds a matter document.
 *
 * Vault matters expose no modification timestamp, so change detection hashes the
 * matter's own metadata fields. Every field in the hash comes from the `view=FULL`
 * payload, which `listDocuments` and `getDocument` both request — so the hash is
 * identical on both paths.
 */
async function matterToDocument(matter: VaultMatter): Promise<ExternalDocument> {
  const matterId = matter.matterId ?? ''
  const canonical = JSON.stringify({
    name: matter.name ?? '',
    description: matter.description ?? '',
    state: matter.state ?? '',
    matterRegion: matter.matterRegion ?? '',
    permissions: (matter.matterPermissions ?? [])
      .map((permission) => `${permission.accountId ?? ''}:${permission.role ?? ''}`)
      .sort(),
  })

  return {
    externalId: `matter:${matterId}`,
    title: matter.name || `Matter ${matterId}`,
    content: renderMatter(matter),
    mimeType: 'text/plain',
    contentHash: `gvault:matter:${matterId}:${await computeContentHash(canonical)}`,
    metadata: {
      resourceType: 'matter',
      matterId,
      state: matter.state,
    },
  }
}

/**
 * Builds a hold document. Holds carry `updateTime`, which Vault bumps on every
 * modification, so it is a sufficient change indicator.
 */
function holdToDocument(hold: VaultHold, matterId: string): ExternalDocument {
  const holdId = hold.holdId ?? ''
  return {
    externalId: `hold:${matterId}:${holdId}`,
    title: hold.name || `Hold ${holdId}`,
    content: renderHold(hold, matterId),
    mimeType: 'text/plain',
    contentHash: `gvault:hold:${matterId}:${holdId}:${hold.updateTime ?? ''}`,
    metadata: {
      resourceType: 'hold',
      matterId,
      corpus: hold.corpus,
      lastModified: hold.updateTime,
    },
  }
}

/**
 * Builds a saved query document. Saved queries are immutable once created (the API
 * exposes only create, get, list, and delete), so `createTime` identifies the version.
 * The `v2` token in the hash tracks the rendering itself: because the source can never
 * change, a rendering change would otherwise never re-index existing documents.
 */
function savedQueryToDocument(savedQuery: VaultSavedQuery, matterId: string): ExternalDocument {
  const savedQueryId = savedQuery.savedQueryId ?? ''
  return {
    externalId: `savedQuery:${matterId}:${savedQueryId}`,
    title: savedQuery.displayName || `Saved query ${savedQueryId}`,
    content: renderSavedQuery(savedQuery, matterId),
    mimeType: 'text/plain',
    contentHash: `gvault:savedquery:v2:${matterId}:${savedQueryId}:${savedQuery.createTime ?? ''}`,
    metadata: {
      resourceType: 'savedQuery',
      matterId,
      corpus: savedQuery.query?.corpus,
      lastModified: savedQuery.createTime,
    },
  }
}

/** Fetches one page of matters (or the single configured matter). */
async function fetchMattersPage(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  pageToken?: string
): Promise<{ matters: VaultMatter[]; nextPageToken?: string }> {
  const singleMatterId = readString(sourceConfig.matterId)

  if (singleMatterId) {
    const response = await vaultGet(
      accessToken,
      `${VAULT_API_BASE}/matters/${encodeURIComponent(singleMatterId)}?view=FULL`,
      'matters.get'
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch Vault matter ${singleMatterId}: ${response.status}`)
    }
    return { matters: [(await response.json()) as VaultMatter] }
  }

  const params = new URLSearchParams({ view: 'FULL', pageSize: String(PAGE_SIZE) })
  const state = readString(sourceConfig.matterState)
  if (state && state !== 'ALL') params.set('state', state)
  if (pageToken) params.set('pageToken', pageToken)

  const response = await vaultGet(
    accessToken,
    `${VAULT_API_BASE}/matters?${params.toString()}`,
    'matters.list'
  )
  if (!response.ok) {
    throw new Error(`Failed to list Vault matters: ${response.status}`)
  }

  const data = (await response.json()) as { matters?: VaultMatter[]; nextPageToken?: string }
  return { matters: data.matters ?? [], nextPageToken: data.nextPageToken }
}

/** Fetches one page of a matter's child resources of the given kind. */
async function fetchChildPage(
  accessToken: string,
  matterId: string,
  kind: VaultChildKind,
  pageToken?: string
): Promise<{ documents: ExternalDocument[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) })
  if (kind === 'holds') params.set('view', 'FULL_HOLD')
  if (pageToken) params.set('pageToken', pageToken)

  const response = await vaultGet(
    accessToken,
    `${VAULT_API_BASE}/matters/${encodeURIComponent(matterId)}/${kind}?${params.toString()}`,
    `matters.${kind}.list`
  )
  if (!response.ok) {
    throw new Error(`Failed to list ${kind} for matter ${matterId}: ${response.status}`)
  }

  if (kind === 'holds') {
    const data = (await response.json()) as { holds?: VaultHold[]; nextPageToken?: string }
    return {
      documents: (data.holds ?? []).map((hold) => holdToDocument(hold, matterId)),
      nextPageToken: data.nextPageToken,
    }
  }

  const data = (await response.json()) as {
    savedQueries?: VaultSavedQuery[]
    nextPageToken?: string
  }
  return {
    documents: (data.savedQueries ?? []).map((savedQuery) =>
      savedQueryToDocument(savedQuery, matterId)
    ),
    nextPageToken: data.nextPageToken,
  }
}

/**
 * Drains every page of one matter's child listing of the given kind.
 *
 * `capped` is true when the listing was cut short — by the page bound or by a request
 * failure (a matter the caller cannot read, or a transient error). The caller turns
 * that into `syncContext.listingCapped` so deletion reconciliation is skipped for the
 * run rather than hard-deleting documents that still exist at the source.
 */
async function fetchAllChildren(
  accessToken: string,
  matterId: string,
  kind: VaultChildKind
): Promise<{ documents: ExternalDocument[]; capped: boolean }> {
  const documents: ExternalDocument[] = []
  let pageToken: string | undefined

  try {
    for (let page = 0; page < MAX_CHILD_PAGES; page++) {
      const result = await fetchChildPage(accessToken, matterId, kind, pageToken)
      documents.push(...result.documents)
      if (!result.nextPageToken) return { documents, capped: false }
      pageToken = result.nextPageToken
    }
  } catch (error) {
    logger.warn(`Failed to list ${kind} for Vault matter ${matterId}`, {
      error: toError(error).message,
    })
    return { documents, capped: true }
  }

  logger.warn(`Stopped listing ${kind} for Vault matter ${matterId} at the page bound`, {
    maxChildPages: MAX_CHILD_PAGES,
  })
  return { documents, capped: true }
}

/**
 * Lists every enabled child resource for a batch of matters, bounded concurrency.
 *
 * One `listDocuments` call covers a whole batch, which keeps the number of calls a
 * sync needs proportional to the matter count rather than to `matters × kinds ×
 * child pages`.
 */
async function fetchChildrenForMatters(
  accessToken: string,
  matterIds: string[],
  kinds: VaultChildKind[]
): Promise<{ documents: ExternalDocument[]; capped: boolean }> {
  const tasks: { matterId: string; kind: VaultChildKind }[] = []
  for (const matterId of matterIds) {
    for (const kind of kinds) tasks.push({ matterId, kind })
  }

  const documents: ExternalDocument[] = []
  let capped = false

  for (let index = 0; index < tasks.length; index += CHILD_CONCURRENCY) {
    const results = await Promise.all(
      tasks
        .slice(index, index + CHILD_CONCURRENCY)
        .map((task) => fetchAllChildren(accessToken, task.matterId, task.kind))
    )
    for (const result of results) {
      documents.push(...result.documents)
      if (result.capped) capped = true
    }
  }

  return { documents, capped }
}

export const googleVaultConnector: ConnectorConfig = {
  ...googleVaultConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const kinds = enabledChildKinds(sourceConfig)
    const state = decodeCursor(cursor)

    let pageDocuments: ExternalDocument[] = []
    let nextState: VaultCursor | undefined

    if (state.phase === 'matters') {
      const { matters, nextPageToken } = await fetchMattersPage(
        accessToken,
        sourceConfig,
        state.mattersPageToken
      )
      pageDocuments = await Promise.all(matters.map(matterToDocument))

      const matterIds = matters
        .map((matter) => matter.matterId)
        .filter((matterId): matterId is string => Boolean(matterId))

      if (kinds.length > 0 && matterIds.length > 0) {
        nextState = {
          phase: 'children',
          matterIds,
          matterIndex: 0,
          nextMattersPageToken: nextPageToken,
        }
      } else if (nextPageToken) {
        nextState = { phase: 'matters', mattersPageToken: nextPageToken }
      }
    } else {
      const matterIds = state.matterIds ?? []
      const batchStart = state.matterIndex ?? 0
      const batch = matterIds.slice(batchStart, batchStart + CHILD_MATTER_BATCH)

      if (batch.length > 0 && kinds.length > 0) {
        const children = await fetchChildrenForMatters(accessToken, batch, kinds)
        pageDocuments = children.documents
        if (children.capped && syncContext) syncContext.listingCapped = true
      }

      const nextMatterIndex = batchStart + batch.length
      if (nextMatterIndex < matterIds.length && kinds.length > 0) {
        nextState = { ...state, matterIndex: nextMatterIndex }
      } else if (state.nextMattersPageToken) {
        nextState = { phase: 'matters', mattersPageToken: state.nextMattersPageToken }
      }
    }

    const maxDocuments = readMaxDocuments(sourceConfig.maxDocuments)
    const alreadyFetched = (syncContext?.totalDocsFetched as number | undefined) ?? 0
    const { documents, indexableCount, capReached } = takeIndexableWithinCap(
      pageDocuments,
      () => false,
      maxDocuments,
      alreadyFetched
    )
    if (syncContext) syncContext.totalDocsFetched = alreadyFetched + indexableCount

    const truncated = documents.length < pageDocuments.length
    if (syncContext && (truncated || (capReached && nextState !== undefined))) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: capReached || !nextState ? undefined : encodeCursor(nextState),
      hasMore: !capReached && nextState !== undefined,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const [kind, first, second] = externalId.split(':')

    try {
      if (kind === 'matter') {
        const response = await vaultGet(
          accessToken,
          `${VAULT_API_BASE}/matters/${encodeURIComponent(first)}?view=FULL`,
          'matters.get'
        )
        if (response.status === 404 || response.status === 403) return null
        if (!response.ok) throw new Error(`Failed to fetch Vault matter: ${response.status}`)
        return await matterToDocument((await response.json()) as VaultMatter)
      }

      if (kind === 'hold') {
        const response = await vaultGet(
          accessToken,
          `${VAULT_API_BASE}/matters/${encodeURIComponent(first)}/holds/${encodeURIComponent(second)}?view=FULL_HOLD`,
          'matters.holds.get'
        )
        if (response.status === 404 || response.status === 403) return null
        if (!response.ok) throw new Error(`Failed to fetch Vault hold: ${response.status}`)
        return holdToDocument((await response.json()) as VaultHold, first)
      }

      if (kind === 'savedQuery') {
        const response = await vaultGet(
          accessToken,
          `${VAULT_API_BASE}/matters/${encodeURIComponent(first)}/savedQueries/${encodeURIComponent(second)}`,
          'matters.savedQueries.get'
        )
        if (response.status === 404 || response.status === 403) return null
        if (!response.ok) throw new Error(`Failed to fetch Vault saved query: ${response.status}`)
        return savedQueryToDocument((await response.json()) as VaultSavedQuery, first)
      }

      logger.warn('Unrecognized Google Vault external ID', { externalId })
      return null
    } catch (error) {
      /**
       * Only the explicit 404/403 checks above (and an unrecognized externalId kind) mean
       * the object is genuinely gone or unreachable. Everything else is rethrown so the
       * sync engine records a failed row instead of dropping the document silently.
       */
      logger.warn(`Failed to fetch Google Vault document ${externalId}`, {
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxDocumentsInput = readString(sourceConfig.maxDocuments)
    if (maxDocumentsInput && readMaxDocuments(maxDocumentsInput) === 0) {
      return { valid: false, error: 'Max documents must be a positive number' }
    }

    const matterState = readString(sourceConfig.matterState)
    if (matterState && !['ALL', 'OPEN', 'CLOSED'].includes(matterState)) {
      return { valid: false, error: `Unsupported matter state "${matterState}"` }
    }

    const matterId = readString(sourceConfig.matterId)

    try {
      const url = matterId
        ? `${VAULT_API_BASE}/matters/${encodeURIComponent(matterId)}?view=BASIC`
        : `${VAULT_API_BASE}/matters?pageSize=1&view=BASIC`

      const response = await vaultGet(
        accessToken,
        url,
        matterId ? 'matters.get' : 'matters.list',
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (matterId && response.status === 404) {
          return {
            valid: false,
            error: `Matter "${matterId}" not found. Check the matter ID and your Vault permissions.`,
          }
        }
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error:
              'Google Vault access denied. The account needs Vault privileges and the eDiscovery scope.',
          }
        }
        return { valid: false, error: `Failed to access Google Vault: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const resourceType = readString(metadata.resourceType)
    if (resourceType) result.resourceType = resourceType

    const matterId = readString(metadata.matterId)
    if (matterId) result.matterId = matterId

    const state = readString(metadata.state)
    if (state) result.state = state

    const corpus = readString(metadata.corpus)
    if (corpus) result.corpus = corpus

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
