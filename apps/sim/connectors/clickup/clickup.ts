import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { clickupConnectorMeta } from '@/connectors/clickup/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'
import { clickupAuthorizationHeader, extractClickUpErrorMessage } from '@/tools/clickup/shared'

const logger = createLogger('ClickUpConnector')

const CLICKUP_API_V3_BASE_URL = 'https://api.clickup.com/api/v3'

/** Maximum page size accepted by the Search Docs endpoint. */
const LIST_PAGE_SIZE = 100

/** Minimum page size accepted by the Search Docs endpoint (used for validation probes). */
const VALIDATE_PAGE_SIZE = 10

/**
 * Core Doc fields from the v3 Search Docs / Fetch Doc responses
 * (`PublicDocsDocCoreDto` in ClickUp's OpenAPI spec).
 */
interface ClickUpDoc {
  id: string
  name: string
  dateCreated?: number
  dateUpdated?: number
  isPublic?: boolean
  deleted: boolean
  archived: boolean
}

/**
 * Page fields from the v3 Fetch Pages response (`PublicDocsPageV3Dto`).
 * Pages nest recursively via `pages`.
 */
interface ClickUpDocPage {
  name: string
  content: string
  deleted?: boolean
  archived?: boolean
  pages: ClickUpDocPage[]
}

function buildHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: clickupAuthorizationHeader(accessToken),
  }
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Parses a raw Doc object from the Search Docs / Fetch Doc responses.
 * Returns null when the payload is missing the documented required fields.
 */
function parseDoc(value: unknown): ClickUpDoc | null {
  if (!isRecordLike(value)) return null
  const id = typeof value.id === 'string' ? value.id : undefined
  if (!id) return null

  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : 'Untitled',
    dateCreated: getOptionalNumber(value.date_created),
    dateUpdated: getOptionalNumber(value.date_updated),
    isPublic: typeof value.public === 'boolean' ? value.public : undefined,
    deleted: value.deleted === true,
    archived: value.archived === true,
  }
}

/**
 * Parses a raw page object from the Fetch Pages response, keeping nested subpages.
 */
function parsePage(value: unknown): ClickUpDocPage | null {
  if (!isRecordLike(value)) return null
  const rawSubpages = Array.isArray(value.pages) ? value.pages : []

  return {
    name: typeof value.name === 'string' ? value.name : '',
    content: typeof value.content === 'string' ? value.content : '',
    deleted: value.deleted === true,
    archived: value.archived === true,
    pages: rawSubpages
      .map((subpage) => parsePage(subpage))
      .filter((subpage): subpage is ClickUpDocPage => subpage !== null),
  }
}

/**
 * Flattens a Doc's page tree depth-first into markdown sections, skipping
 * deleted and archived pages (their subpages are skipped with them).
 */
function flattenPages(pages: ClickUpDocPage[], sections: string[]): void {
  for (const page of pages) {
    if (page.deleted || page.archived) continue
    const parts: string[] = []
    if (page.name.trim()) parts.push(`# ${page.name.trim()}`)
    if (page.content.trim()) parts.push(page.content.trim())
    if (parts.length > 0) sections.push(parts.join('\n\n'))
    flattenPages(page.pages, sections)
  }
}

/**
 * Produces a lightweight metadata stub for a Doc. The contentHash is derived
 * from the Doc's `date_updated` so it is identical whether built from the
 * Search Docs listing or the Fetch Doc response.
 */
function docToStub(doc: ClickUpDoc, workspaceId: string): ExternalDocument {
  return {
    externalId: doc.id,
    title: doc.name,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://app.clickup.com/${workspaceId}/v/dc/${doc.id}`,
    contentHash: `clickup:${doc.id}:${doc.dateUpdated ?? ''}`,
    metadata: {
      created: doc.dateCreated != null ? new Date(doc.dateCreated).toISOString() : undefined,
      lastUpdated: doc.dateUpdated != null ? new Date(doc.dateUpdated).toISOString() : undefined,
      public: doc.isPublic,
    },
  }
}

/**
 * Builds the Search Docs URL for a workspace, optionally filtered to the Docs
 * whose parent container is the given Space.
 */
function buildSearchDocsUrl(
  workspaceId: string,
  options: { spaceId?: string; limit: number; cursor?: string }
): string {
  const params = new URLSearchParams()
  params.append('limit', String(options.limit))
  if (options.cursor) params.append('cursor', options.cursor)
  if (options.spaceId) {
    params.append('parent_id', options.spaceId)
    params.append('parent_type', 'SPACE')
  }
  return `${CLICKUP_API_V3_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/docs?${params.toString()}`
}

function getRequiredWorkspaceId(sourceConfig: Record<string, unknown>): string {
  const workspaceId = typeof sourceConfig.teamId === 'string' ? sourceConfig.teamId.trim() : ''
  if (!workspaceId) {
    throw new Error('ClickUp workspace ID is required')
  }
  return workspaceId
}

export const clickupConnector: ConnectorConfig = {
  ...clickupConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const workspaceId = getRequiredWorkspaceId(sourceConfig)
    const spaceId =
      typeof sourceConfig.spaceId === 'string' && sourceConfig.spaceId.trim()
        ? sourceConfig.spaceId.trim()
        : undefined
    const maxDocs = sourceConfig.maxDocs ? Number(sourceConfig.maxDocs) : 0

    const url = buildSearchDocsUrl(workspaceId, { spaceId, limit: LIST_PAGE_SIZE, cursor })
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: buildHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list ClickUp Docs', { status: response.status, error: errorText })
      throw new Error(`Failed to list ClickUp Docs: ${response.status}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const rawDocs = Array.isArray(data.docs) ? data.docs : []

    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const remaining =
      maxDocs > 0 ? Math.max(0, maxDocs - previouslyFetched) : Number.POSITIVE_INFINITY

    const pageDocuments: ExternalDocument[] = []
    for (const rawDoc of rawDocs) {
      const doc = parseDoc(rawDoc)
      if (!doc || doc.deleted || doc.archived) continue
      pageDocuments.push(docToStub(doc, workspaceId))
    }
    const documents = pageDocuments.slice(0, remaining)
    const trimmedByCap = documents.length < pageDocuments.length

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const nextCursor =
      typeof data.next_cursor === 'string' && data.next_cursor ? data.next_cursor : undefined
    const hitLimit = maxDocs > 0 && totalFetched >= maxDocs
    const capTruncatedListing = hitLimit && (trimmedByCap || Boolean(nextCursor))
    if (capTruncatedListing && syncContext) syncContext.listingCapped = true

    return {
      documents,
      nextCursor: hitLimit ? undefined : nextCursor,
      hasMore: hitLimit ? false : Boolean(nextCursor),
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const workspaceId = getRequiredWorkspaceId(sourceConfig)
    const headers = buildHeaders(accessToken)
    const docUrl = `${CLICKUP_API_V3_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/docs/${encodeURIComponent(externalId)}`

    const docResponse = await fetchWithRetry(docUrl, { method: 'GET', headers })
    if (docResponse.status === 404) return null
    if (!docResponse.ok) {
      throw new Error(`Failed to fetch ClickUp Doc ${externalId}: ${docResponse.status}`)
    }

    const doc = parseDoc(await docResponse.json())
    if (!doc || doc.deleted || doc.archived) return null

    const pagesParams = new URLSearchParams({ max_page_depth: '-1', content_format: 'text/md' })
    const pagesUrl = `${docUrl}/pages?${pagesParams.toString()}`
    const pagesResponse = await fetchWithRetry(pagesUrl, { method: 'GET', headers })
    if (!pagesResponse.ok) {
      throw new Error(
        `Failed to fetch pages for ClickUp Doc ${externalId}: ${pagesResponse.status}`
      )
    }

    const rawPages = await pagesResponse.json()
    const pages = (Array.isArray(rawPages) ? rawPages : [])
      .map((page) => parsePage(page))
      .filter((page): page is ClickUpDocPage => page !== null)

    const sections: string[] = []
    flattenPages(pages, sections)
    const content = sections.join('\n\n')
    if (!content.trim()) {
      logger.warn(`ClickUp Doc has no indexable page content: ${externalId}`)
      return null
    }

    return {
      ...docToStub(doc, workspaceId),
      content,
      contentDeferred: false,
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const workspaceId = typeof sourceConfig.teamId === 'string' ? sourceConfig.teamId.trim() : ''
    if (!workspaceId) {
      return { valid: false, error: 'Workspace is required' }
    }

    const maxDocs = sourceConfig.maxDocs as string | undefined
    if (maxDocs && (Number.isNaN(Number(maxDocs)) || Number(maxDocs) <= 0)) {
      return { valid: false, error: 'Max docs must be a positive number' }
    }

    const spaceId =
      typeof sourceConfig.spaceId === 'string' && sourceConfig.spaceId.trim()
        ? sourceConfig.spaceId.trim()
        : undefined

    try {
      const url = buildSearchDocsUrl(workspaceId, { spaceId, limit: VALIDATE_PAGE_SIZE })
      const response = await fetchWithRetry(
        url,
        { method: 'GET', headers: buildHeaders(accessToken) },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        return {
          valid: false,
          error: extractClickUpErrorMessage(response, data, 'Failed to access ClickUp Docs'),
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const created = parseTagDate(metadata.created)
    if (created) result.created = created

    const lastUpdated = parseTagDate(metadata.lastUpdated)
    if (lastUpdated) result.lastUpdated = lastUpdated

    if (typeof metadata.public === 'boolean') result.public = metadata.public

    return result
  },
}
