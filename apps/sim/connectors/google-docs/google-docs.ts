import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { googleDocsConnectorMeta } from '@/connectors/google-docs/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  buildDriveParentsClause,
  ConnectorFileTooLargeError,
  joinTagArray,
  markSkipped,
  parseMultiValue,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
} from '@/connectors/utils'

const logger = createLogger('GoogleDocsConnector')

/**
 * Ceiling for the raw `documents.get` JSON body, applied as a streaming memory
 * guard. A Google Doc holds at most 1.02 million characters and the structured
 * response inflates that with per-run styling, so this is an absolute bound
 * rather than a multiple of `CONNECTOR_MAX_FILE_BYTES` — that cap is 100MB, and
 * a multiple of it would both admit hundreds of megabytes into memory and sit so
 * far above any reachable document that the guard could never fire.
 */
const MAX_DOCS_RESPONSE_BYTES = 100 * 1024 * 1024

/** Drive `files.list` page size. The API caps `pageSize` at 1000. */
const PAGE_SIZE = 100

const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document'

/**
 * Represents a Google Drive file entry returned by the Drive API.
 */
interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  createdTime?: string
  webViewLink?: string
  owners?: { displayName?: string; emailAddress?: string }[]
}

/**
 * A single element inside a paragraph. Only the variants that carry readable
 * text are modeled — `pageBreak`, `columnBreak`, `horizontalRule`, `equation`,
 * and `inlineObjectElement` contribute nothing to a plain-text rendering.
 */
interface DocsParagraphElement {
  textRun?: { content?: string }
  richLink?: { richLinkProperties?: { title?: string; uri?: string } }
  person?: { personProperties?: { name?: string; email?: string } }
}

/**
 * Represents a structural element within a Google Docs document body. The Docs
 * API models `body.content` as a union of `paragraph`, `table`,
 * `tableOfContents`, and `sectionBreak`; table cells and the table of contents
 * nest further `StructuralElement` arrays.
 */
interface DocsStructuralElement {
  paragraph?: {
    paragraphStyle?: {
      namedStyleType?: string
    }
    bullet?: Record<string, unknown>
    elements?: DocsParagraphElement[]
  }
  table?: {
    tableRows?: {
      tableCells?: {
        content?: DocsStructuralElement[]
      }[]
    }[]
  }
  tableOfContents?: {
    content?: DocsStructuralElement[]
  }
}

/**
 * A tab of a Google Doc. Tabs may nest arbitrarily deep via `childTabs`.
 */
interface DocsTab {
  documentTab?: {
    body?: { content?: DocsStructuralElement[] }
  }
  childTabs?: DocsTab[]
}

/**
 * Represents the response from the Google Docs API for a single document. With
 * `includeTabsContent=true` the content lands in `tabs` and the legacy `body`
 * field is left empty; `body` is retained only as a fallback in case the request
 * is ever served without tab content.
 */
interface DocsDocument {
  body?: {
    content?: DocsStructuralElement[]
  }
  tabs?: DocsTab[]
}

/**
 * Maps a Google Docs heading style to a Markdown heading prefix.
 */
function headingPrefix(namedStyleType?: string): string {
  switch (namedStyleType) {
    case 'HEADING_1':
      return '# '
    case 'HEADING_2':
      return '## '
    case 'HEADING_3':
      return '### '
    case 'HEADING_4':
      return '#### '
    case 'HEADING_5':
      return '##### '
    case 'HEADING_6':
      return '###### '
    default:
      return ''
  }
}

/**
 * Renders the readable text of a single paragraph element. `richLink` and
 * `person` carry user-visible text that is absent from any `textRun`, so
 * dropping them would silently lose linked-file titles and @-mentions.
 */
function paragraphElementText(element: DocsParagraphElement): string {
  if (element.textRun?.content) return element.textRun.content
  if (element.richLink?.richLinkProperties) {
    const { title, uri } = element.richLink.richLinkProperties
    return title || uri || ''
  }
  if (element.person?.personProperties) {
    const { name, email } = element.person.personProperties
    return name || email || ''
  }
  return ''
}

/**
 * Extracts plain text from a list of Docs structural elements, recursing into
 * table cells and the table of contents. Headings are prefixed with
 * Markdown-style `#` markers and list items with `- `.
 */
function extractTextFromStructuralElements(elements: DocsStructuralElement[]): string[] {
  const parts: string[] = []

  for (const element of elements) {
    const paragraph = element.paragraph
    if (paragraph?.elements) {
      const heading = headingPrefix(paragraph.paragraphStyle?.namedStyleType)
      const prefix = heading || (paragraph.bullet ? '- ' : '')
      /**
       * Each paragraph's final `textRun.content` already ends with `\n`. Strip
       * it before joining with `\n` so a heading followed by a body paragraph
       * is separated by a single newline, not two.
       */
      const text = paragraph.elements.map(paragraphElementText).join('').replace(/\n+$/, '')

      if (text.trim()) parts.push(`${prefix}${text}`)
      continue
    }

    if (element.table?.tableRows) {
      for (const row of element.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          if (cell.content) parts.push(...extractTextFromStructuralElements(cell.content))
        }
      }
      continue
    }

    if (element.tableOfContents?.content) {
      parts.push(...extractTextFromStructuralElements(element.tableOfContents.content))
    }
  }

  return parts
}

/**
 * Collects the text of a tab and every descendant tab, depth-first in the order
 * the Docs API returns them.
 */
function extractTextFromTabs(tabs: DocsTab[]): string[] {
  const parts: string[] = []

  for (const tab of tabs) {
    const content = tab.documentTab?.body?.content
    if (content) parts.push(...extractTextFromStructuralElements(content))
    if (tab.childTabs?.length) parts.push(...extractTextFromTabs(tab.childTabs))
  }

  return parts
}

/**
 * Extracts plain text from a Google Docs API document response. `tabs` is the
 * source of truth because `includeTabsContent=true` moves all content there and
 * leaves `body` empty; `body` is read only when `tabs` yields nothing, so a
 * response served without tab content still indexes instead of coming back blank.
 */
function extractTextFromDocument(doc: DocsDocument): string {
  const parts = doc.tabs?.length ? extractTextFromTabs(doc.tabs) : []
  if (parts.length === 0 && doc.body?.content) {
    parts.push(...extractTextFromStructuralElements(doc.body.content))
  }

  return parts.join('\n').trim()
}

/**
 * Fetches the structured content of a Google Doc via the Docs API and extracts
 * it as plain text. `includeTabsContent=true` is required — without it the API
 * returns only the first tab's content and every other tab is silently lost.
 * Throws {@link ConnectorFileTooLargeError} when the response body exceeds
 * {@link MAX_DOCS_RESPONSE_BYTES} so it surfaces as a visible skipped row rather
 * than being buffered whole.
 */
async function fetchDocContent(accessToken: string, documentId: string): Promise<string> {
  const params = new URLSearchParams({
    includeTabsContent: 'true',
    fields: 'body.content,tabs',
  })
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}?${params.toString()}`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Google Doc content ${documentId}: ${response.status}`)
  }

  const buffer = await readBodyWithLimit(response, MAX_DOCS_RESPONSE_BYTES)
  if (!buffer) throw new ConnectorFileTooLargeError(MAX_DOCS_RESPONSE_BYTES)

  const doc = JSON.parse(buffer.toString('utf8')) as DocsDocument
  return extractTextFromDocument(doc)
}

/**
 * Creates a lightweight stub from a Drive file entry. Content is deferred
 * and only fetched via getDocument for new or changed documents.
 */
function fileToStub(file: DriveFile): ExternalDocument {
  return {
    externalId: file.id,
    title: file.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
    /**
     * The `v2` namespace is a one-time invalidation. The hash is metadata-only,
     * so a stored document whose Drive `modifiedTime` has not moved is
     * classified `unchanged` and never re-hydrated — it would keep content
     * extracted before `includeTabsContent` and table traversal landed, i.e.
     * missing every tab after the first and every table. Bumping the namespace
     * forces one re-hydration per document, then normal hash gating resumes.
     */
    contentHash: `gdocs:v2:${file.id}:${file.modifiedTime ?? ''}`,
    metadata: {
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
    },
  }
}

/**
 * Builds the Drive API query string for listing Google Docs.
 */
function buildQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = ['trashed = false', `mimeType = '${GOOGLE_DOC_MIME_TYPE}'`]

  const parentsClause = buildDriveParentsClause(parseMultiValue(sourceConfig.folderId))
  if (parentsClause) parts.push(parentsClause)

  return parts.join(' and ')
}

export const googleDocsConnector: ConnectorConfig = {
  ...googleDocsConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const query = buildQuery(sourceConfig)

    const maxDocs = sourceConfig.maxDocs ? Number(sourceConfig.maxDocs) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const remaining = maxDocs > 0 ? maxDocs - previouslyFetched : 0
    const pageSize = remaining > 0 ? Math.min(PAGE_SIZE, remaining) : PAGE_SIZE

    /**
     * `incompleteSearch` must be named in the partial-response mask — Drive's
     * `fields` parameter filters the top-level response too, so omitting it
     * leaves `data.incompleteSearch` permanently `undefined` and the
     * reconciliation guard below dead.
     *
     * Drive returns items in an arbitrary order when `orderBy` is omitted, so a
     * `maxDocs` cap would otherwise select a different, unpredictable subset on
     * every sync. Sorting newest-first makes the capped scope deterministic.
     */
    const queryParams = new URLSearchParams({
      q: query,
      pageSize: String(pageSize),
      orderBy: 'modifiedTime desc',
      fields:
        'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })

    if (cursor) {
      queryParams.set('pageToken', cursor)
    }

    const url = `https://www.googleapis.com/drive/v3/files?${queryParams.toString()}`

    logger.info('Listing Google Docs', { query, cursor: cursor ?? 'initial' })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Google Docs', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list Google Docs: ${response.status}`)
    }

    const data = await response.json()
    const files = (data.files || []) as DriveFile[]

    /**
     * Drive sets `incompleteSearch` when it could not search every corpus (it
     * arises with the `allDrives` scope enabled by `includeItemsFromAllDrives`).
     * A partial listing drops still-existing docs, so reconciliation must be
     * suppressed to avoid hard-deleting valid documents.
     */
    const incompleteSearch = data.incompleteSearch === true

    let documents = files.map(fileToStub)
    let slicedSome = false
    if (maxDocs > 0 && documents.length > remaining) {
      slicedSome = true
      documents = documents.slice(0, remaining)
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxDocs > 0 && totalFetched >= maxDocs

    const nextPageToken = data.nextPageToken as string | undefined

    /**
     * Mark the listing as incomplete so the sync engine skips deletion
     * reconciliation when this page does not represent the full source set:
     * - `slicedSome`: the page held more docs than the `maxDocs` cap allowed.
     * - `hitLimit` with a next page: the cap was reached while more pages remain.
     * - `incompleteSearch`: Drive could not search every corpus, so the page is
     *   partial and may omit still-existing docs.
     * Reconciliation against any of these would hard-delete valid documents.
     */
    if (syncContext && (slicedSome || (hitLimit && Boolean(nextPageToken)) || incompleteSearch)) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hitLimit ? undefined : nextPageToken,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const fields = 'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,trashed'
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Google Doc metadata: ${response.status}`)
    }

    const file = (await response.json()) as DriveFile & { trashed?: boolean }

    if (file.trashed) return null
    if (file.mimeType !== GOOGLE_DOC_MIME_TYPE) return null

    try {
      const content = await fetchDocContent(accessToken, file.id)
      if (!content.trim()) return null

      return { ...fileToStub(file), content, contentDeferred: false }
    } catch (error) {
      /**
       * An oversized doc is a permanent, explainable outcome — surface it as a
       * visible skipped (failed) row rather than dropping it silently.
       */
      if (error instanceof ConnectorFileTooLargeError) {
        return markSkipped(fileToStub(file), sizeLimitSkipReason(MAX_DOCS_RESPONSE_BYTES))
      }
      /**
       * Any other export failure is transient and must propagate so the engine records a
       * failed hydration instead of silently dropping a document that still exists.
       */
      logger.warn(`Failed to extract content from document: ${file.name} (${file.id})`, {
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderIds = parseMultiValue(sourceConfig.folderId)
    const maxDocs = sourceConfig.maxDocs as string | undefined

    if (maxDocs && (Number.isNaN(Number(maxDocs)) || Number(maxDocs) <= 0)) {
      return { valid: false, error: 'Max documents must be a positive number' }
    }

    try {
      if (folderIds.length > 0) {
        for (const folderId of folderIds) {
          const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`
          const response = await fetchWithRetry(
            url,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
              },
            },
            VALIDATE_RETRY_OPTIONS
          )

          if (!response.ok) {
            if (response.status === 404) {
              return {
                valid: false,
                error: `Folder "${folderId}" not found. Check the folder ID and permissions.`,
              }
            }
            return {
              valid: false,
              error: `Failed to access folder "${folderId}": ${response.status}`,
            }
          }

          const folder = await response.json()
          if (folder.mimeType !== 'application/vnd.google-apps.folder') {
            return { valid: false, error: `"${folderId}" is not a folder` }
          }
        }
      } else {
        const probeParams = new URLSearchParams({
          pageSize: '1',
          q: `trashed = false and mimeType = '${GOOGLE_DOC_MIME_TYPE}'`,
          fields: 'files(id)',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        })
        const url = `https://www.googleapis.com/drive/v3/files?${probeParams.toString()}`
        const response = await fetchWithRetry(
          url,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!response.ok) {
          return { valid: false, error: `Failed to access Google Docs: ${response.status}` }
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const owners = joinTagArray(metadata.owners)
    if (owners) result.owners = owners

    const lastModified = parseTagDate(metadata.modifiedTime)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
