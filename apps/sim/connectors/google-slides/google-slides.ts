import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { googleSlidesConnectorMeta } from '@/connectors/google-slides/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  buildDriveParentsClause,
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  joinTagArray,
  markSkipped,
  parseMultiValue,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
} from '@/connectors/utils'

const logger = createLogger('GoogleSlidesConnector')

const PRESENTATION_MIME_TYPE = 'application/vnd.google-apps.presentation'

/** Drive `files.list` page size. The API caps `pageSize` at 1000. */
const PAGE_SIZE = 100

/**
 * Ceiling for the raw `presentations.get` JSON body. The structured response is
 * far larger than the plain text it yields (every run carries its styling), so
 * the cap is applied to the wire body as a memory guard and again to the
 * extracted text against `CONNECTOR_MAX_FILE_BYTES`.
 */
const MAX_SLIDES_RESPONSE_BYTES = 8 * CONNECTOR_MAX_FILE_BYTES

/** Reason recorded for a presentation whose slides contain no extractable text. */
const NO_TEXT = 'No extractable text'

/** Guards against a pathological (or cyclic) group nesting depth. */
const MAX_GROUP_DEPTH = 12

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
 * A single formatting-consistent run of text within a Slides text element.
 */
interface SlidesTextElement {
  textRun?: { content?: string }
}

/**
 * The Slides API `TextContent` object carried by shapes and table cells.
 */
interface SlidesTextContent {
  textElements?: SlidesTextElement[]
}

interface SlidesTableCell {
  text?: SlidesTextContent
}

interface SlidesTableRow {
  tableCells?: SlidesTableCell[]
}

/**
 * A page element on a slide. Exactly one of the visual properties is set;
 * only `shape`, `table`, `wordArt`, and `elementGroup` can carry extractable
 * text — `image`, `video`, `line`, `sheetsChart`, and `speakerSpotlight` do not.
 */
interface SlidesPageElement {
  objectId?: string
  shape?: { text?: SlidesTextContent }
  table?: { tableRows?: SlidesTableRow[] }
  wordArt?: { renderedText?: string }
  elementGroup?: { children?: SlidesPageElement[] }
}

/**
 * A Slides API `Page`. Slides carry `slideProperties.notesPage`, whose
 * `notesProperties.speakerNotesObjectId` names the element holding the notes.
 */
interface SlidesPage {
  objectId?: string
  pageElements?: SlidesPageElement[]
  notesProperties?: { speakerNotesObjectId?: string }
  slideProperties?: { notesPage?: SlidesPage }
}

interface SlidesPresentation {
  slides?: SlidesPage[]
}

/**
 * Flattens a Slides `TextContent` into plain text. Slides encodes a soft line
 * break as a vertical tab, which is normalized to a newline.
 */
function extractTextContent(text: SlidesTextContent | undefined): string {
  const elements = text?.textElements
  if (!elements) return ''

  return elements
    .map((element) => element.textRun?.content ?? '')
    .join('')
    .replace(/\v/g, '\n')
    .replace(/\n+$/, '')
}

/**
 * Walks page elements in document order, appending each element's text to
 * `parts`. Groups are recursed into so nested shapes are not dropped.
 */
function collectElementText(
  elements: SlidesPageElement[] | undefined,
  parts: string[],
  depth: number
): void {
  if (!elements || depth > MAX_GROUP_DEPTH) return

  for (const element of elements) {
    const shapeText = extractTextContent(element.shape?.text)
    if (shapeText.trim()) parts.push(shapeText)

    const wordArtText = element.wordArt?.renderedText
    if (wordArtText?.trim()) parts.push(wordArtText.trim())

    const rows = element.table?.tableRows
    if (rows) {
      for (const row of rows) {
        const cells = (row.tableCells ?? [])
          .map((cell) => extractTextContent(cell.text).replace(/\n/g, ' ').trim())
          .filter(Boolean)
        if (cells.length > 0) parts.push(cells.join(' | '))
      }
    }

    if (element.elementGroup?.children) {
      collectElementText(element.elementGroup.children, parts, depth + 1)
    }
  }
}

/**
 * Extracts the speaker notes for a slide. The notes page mirrors the slide's
 * body placeholders, so only the element named by `speakerNotesObjectId` is
 * read — anything else would duplicate the slide's own text.
 */
function extractSpeakerNotes(slide: SlidesPage): string {
  const notesPage = slide.slideProperties?.notesPage
  const notesObjectId = notesPage?.notesProperties?.speakerNotesObjectId
  if (!notesPage || !notesObjectId) return ''

  const notesElement = notesPage.pageElements?.find((element) => element.objectId === notesObjectId)
  return extractTextContent(notesElement?.shape?.text)
}

/**
 * Renders a presentation as plain text, preserving slide order. Each slide is
 * introduced by a Markdown heading so retrieved chunks keep their position.
 */
function extractTextFromPresentation(
  presentation: SlidesPresentation,
  includeSpeakerNotes: boolean
): string {
  const slides = presentation.slides
  if (!slides) return ''

  const sections: string[] = []

  for (let index = 0; index < slides.length; index++) {
    const parts: string[] = []
    collectElementText(slides[index].pageElements, parts, 0)

    if (includeSpeakerNotes) {
      const notes = extractSpeakerNotes(slides[index])
      if (notes.trim()) parts.push(`Speaker notes: ${notes}`)
    }

    if (parts.length > 0) {
      sections.push(`## Slide ${index + 1}\n${parts.join('\n')}`)
    }
  }

  return sections.join('\n\n').trim()
}

/**
 * Fetches a presentation via the Slides API and extracts its text. Only the
 * `slides` field is requested — masters, layouts, and the notes master carry
 * template boilerplate that would pollute the index.
 */
async function fetchPresentationContent(
  accessToken: string,
  presentationId: string,
  includeSpeakerNotes: boolean
): Promise<string> {
  const url = `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}?fields=slides`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google Slides presentation ${presentationId}: ${response.status}`
    )
  }

  const buffer = await readBodyWithLimit(response, MAX_SLIDES_RESPONSE_BYTES)
  if (!buffer) throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)

  const presentation = JSON.parse(buffer.toString('utf8')) as SlidesPresentation
  const text = extractTextFromPresentation(presentation, includeSpeakerNotes)

  if (Buffer.byteLength(text, 'utf8') > CONNECTOR_MAX_FILE_BYTES) {
    throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)
  }

  return text
}

/**
 * Resolves the speaker-notes preference. Notes are included unless the user
 * explicitly opted out, so an unset legacy config keeps the richer content.
 */
function shouldIncludeSpeakerNotes(sourceConfig: Record<string, unknown>): boolean {
  return sourceConfig.includeSpeakerNotes !== 'no'
}

/**
 * Creates a lightweight stub from a Drive file entry. Content is deferred
 * and only fetched via getDocument for new or changed documents.
 */
function fileToStub(file: DriveFile, includeSpeakerNotes: boolean): ExternalDocument {
  return {
    externalId: file.id,
    title: file.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: file.webViewLink || `https://docs.google.com/presentation/d/${file.id}/edit`,
    /**
     * The speaker-notes setting selects what the rendered content contains, so it
     * belongs in the hash. Without it, toggling the option leaves every stored
     * hash matching and no presentation is ever re-hydrated with the new scope.
     */
    contentHash: `gslides:${file.id}:${file.modifiedTime ?? ''}:${includeSpeakerNotes ? 'n1' : 'n0'}`,
    metadata: {
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
    },
  }
}

/**
 * Builds the Drive API query string for listing Google Slides presentations.
 * When `lastSyncAt` is supplied the listing is narrowed to presentations
 * touched since the previous sync.
 */
function buildQuery(sourceConfig: Record<string, unknown>, lastSyncAt?: Date): string {
  const parts: string[] = ['trashed = false', `mimeType = '${PRESENTATION_MIME_TYPE}'`]

  const parentsClause = buildDriveParentsClause(parseMultiValue(sourceConfig.folderId))
  if (parentsClause) parts.push(parentsClause)

  if (lastSyncAt && !Number.isNaN(lastSyncAt.getTime())) {
    parts.push(`modifiedTime > '${lastSyncAt.toISOString()}'`)
  }

  return parts.join(' and ')
}

export const googleSlidesConnector: ConnectorConfig = {
  ...googleSlidesConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const query = buildQuery(sourceConfig, lastSyncAt)

    const maxDocs = sourceConfig.maxDocs ? Number(sourceConfig.maxDocs) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    /** Last-page precision: never ask Drive for more files than the cap still allows. */
    const remaining = maxDocs > 0 ? Math.max(0, maxDocs - previouslyFetched) : 0
    const pageSize = remaining > 0 ? Math.min(PAGE_SIZE, remaining) : PAGE_SIZE

    /**
     * `incompleteSearch` must be named in the partial-response mask — Drive's
     * `fields` parameter filters the top-level response too, so omitting it
     * leaves `data.incompleteSearch` permanently `undefined` and the
     * reconciliation guard below dead.
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

    logger.info('Listing Google Slides presentations', { query, cursor: cursor ?? 'initial' })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Google Slides presentations', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list Google Slides presentations: ${response.status}`)
    }

    const data = await response.json()
    const files = (data.files || []) as DriveFile[]

    /**
     * Drive sets `incompleteSearch` when it could not search every corpus (it
     * arises with the `allDrives` scope enabled by `includeItemsFromAllDrives`).
     * A partial listing drops still-existing presentations, so reconciliation
     * must be suppressed to avoid hard-deleting valid documents.
     */
    const incompleteSearch = data.incompleteSearch === true

    const includeSpeakerNotes = shouldIncludeSpeakerNotes(sourceConfig)
    let documents = files.map((file) => fileToStub(file, includeSpeakerNotes))
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
     * - `slicedSome`: the page held more presentations than `maxDocs` allowed.
     * - `hitLimit` with a next page: the cap was reached while pages remain.
     * - `incompleteSearch`: Drive could not search every corpus, so the page is
     *   partial and may omit still-existing presentations.
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
    sourceConfig: Record<string, unknown>,
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
      throw new Error(`Failed to get Google Slides metadata: ${response.status}`)
    }

    const file = (await response.json()) as DriveFile & { trashed?: boolean }

    if (file.trashed) return null
    if (file.mimeType !== PRESENTATION_MIME_TYPE) return null

    const includeSpeakerNotes = shouldIncludeSpeakerNotes(sourceConfig)

    let content: string
    try {
      content = await fetchPresentationContent(accessToken, file.id, includeSpeakerNotes)
    } catch (error) {
      /**
       * An oversized deck is a permanent, explainable outcome — surface it as a
       * visible skipped row. Any other failure is transient and must propagate
       * so the engine records a failed hydration instead of persisting an empty
       * document.
       */
      if (error instanceof ConnectorFileTooLargeError) {
        return markSkipped(
          fileToStub(file, includeSpeakerNotes),
          sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES)
        )
      }
      throw error
    }

    /**
     * An image-only deck carries no extractable text. Surfacing it as a skipped
     * row keeps it visible in the knowledge base UI — returning `null` would
     * make the engine drop the document with no reason recorded, so the
     * presentation would simply be missing and re-fetched on every sync.
     */
    if (!content.trim()) {
      return markSkipped(fileToStub(file, includeSpeakerNotes), NO_TEXT)
    }

    return { ...fileToStub(file, includeSpeakerNotes), content, contentDeferred: false }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderIds = parseMultiValue(sourceConfig.folderId)
    const maxDocs = sourceConfig.maxDocs as string | undefined

    if (maxDocs && (Number.isNaN(Number(maxDocs)) || Number(maxDocs) <= 0)) {
      return { valid: false, error: 'Max presentations must be a positive number' }
    }

    const includeSpeakerNotes = sourceConfig.includeSpeakerNotes
    if (
      includeSpeakerNotes != null &&
      includeSpeakerNotes !== '' &&
      includeSpeakerNotes !== 'yes' &&
      includeSpeakerNotes !== 'no'
    ) {
      return { valid: false, error: 'Speaker notes must be either "yes" or "no"' }
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
          q: `trashed = false and mimeType = '${PRESENTATION_MIME_TYPE}'`,
          fields: 'files(id)',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        })
        const response = await fetchWithRetry(
          `https://www.googleapis.com/drive/v3/files?${probeParams.toString()}`,
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
          return { valid: false, error: `Failed to access Google Slides: ${response.status}` }
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
