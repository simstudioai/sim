import { isRecordLike, toRecord } from '@sim/utils/object'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Resolve the document ID for a Docs API request, preferring the selected
 * document ID and falling back to a manually entered one. Throws when neither
 * is present so callers fail loudly before issuing a request.
 */
export function resolveDocumentId(params: {
  documentId?: string
  manualDocumentId?: string
}): string {
  const documentId = params.documentId?.trim() || params.manualDocumentId?.trim()
  if (!documentId) {
    throw new Error('Document ID is required')
  }
  return safeUrlPathSegment(documentId, 'documentId')
}

/**
 * Normalize an optional tab ID. Returns `undefined` when absent or blank so the
 * request targets the document's first tab, matching the API default.
 */
export function resolveTabId(tabId: unknown): string | undefined {
  if (tabId === undefined || tabId === null) return undefined
  if (typeof tabId !== 'string') throw new Error('Tab ID must be a string')
  const trimmed = tabId.trim()
  return trimmed || undefined
}

/**
 * Parse an optional numeric param that may arrive as a number or a numeric
 * string (agent tool-calls). Returns `undefined` when absent or not finite.
 */
export function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || typeof value === 'boolean') return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Normalize an optional boolean param that may arrive as a real boolean or as a
 * string (`"true"`/`"false"`), which happens when values come from block inputs
 * or agent tool-calls rather than a typed UI switch. Returns `undefined` when the
 * value is absent or unrecognized so callers can skip the field entirely.
 */
export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return undefined
}

/**
 * Build a `Location` for a batchUpdate request when an insertion index is
 * provided, otherwise fall back to `endOfSegmentLocation` (end of the body).
 * The Docs API treats index 0 as invalid, so a positive index is required to
 * use an explicit location.
 */
export function buildInsertLocation(
  rawIndex?: unknown,
  tabId?: string
): { location: { index: number; tabId?: string } } | { endOfSegmentLocation: { tabId?: string } } {
  const tab = tabId ? { tabId } : {}
  const index = parseOptionalNumber(rawIndex)
  if (index !== undefined && index >= 1) {
    return { location: { index, ...tab } }
  }
  return { endOfSegmentLocation: { ...tab } }
}

/**
 * Build and validate a Docs API `Range` from a start and end character index.
 * The Docs API requires `endIndex` to be strictly greater than `startIndex`.
 * Throws when either index is missing or the range is empty/inverted so callers
 * fail loudly before issuing a request.
 */
export function buildContentRange(
  startIndex: unknown,
  endIndex: unknown
): { startIndex: number; endIndex: number } {
  const start = Number(startIndex)
  const end = Number(endIndex)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('startIndex and endIndex are required')
  }
  if (end <= start) {
    throw new Error('endIndex must be greater than startIndex')
  }
  return { startIndex: start, endIndex: end }
}

/**
 * Build canonical Google Docs metadata from a batchUpdate response. The
 * `documentId` is taken from the response body when present, otherwise parsed
 * from the request URL (`.../documents/{id}:batchUpdate`).
 */
export function buildBatchUpdateMetadata(
  data: { documentId?: string },
  responseUrl: string
): { documentId: string; title: string; mimeType: string; url: string } {
  let documentId = data.documentId ?? ''
  if (!documentId) {
    const urlParts = responseUrl.split('/')
    for (let i = 0; i < urlParts.length; i++) {
      if (urlParts[i] === 'documents' && i + 1 < urlParts.length) {
        documentId = urlParts[i + 1].split(':')[0]
        break
      }
    }
  }

  return {
    documentId,
    title: 'Updated Document',
    mimeType: 'application/vnd.google-apps.document',
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Visible text of one paragraph element. Smart chips (person, rich link, date)
 * render as text in the document, so they are included alongside text runs.
 */
function extractParagraphElementText(element: unknown): string {
  if (!isRecordLike(element)) return ''
  const { textRun, person, richLink, dateElement } = element
  if (isRecordLike(textRun)) return readString(textRun.content) ?? ''
  if (isRecordLike(person) && isRecordLike(person.personProperties)) {
    const props = person.personProperties
    return readString(props.name) ?? readString(props.email) ?? ''
  }
  if (isRecordLike(richLink) && isRecordLike(richLink.richLinkProperties)) {
    const props = richLink.richLinkProperties
    return readString(props.title) ?? readString(props.uri) ?? ''
  }
  if (isRecordLike(dateElement) && isRecordLike(dateElement.dateElementProperties)) {
    return readString(dateElement.dateElementProperties.displayText) ?? ''
  }
  return ''
}

function extractStructuralElementsText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const element of content) {
    if (!isRecordLike(element)) continue
    const { paragraph, table } = element
    if (isRecordLike(paragraph) && Array.isArray(paragraph.elements)) {
      for (const paragraphElement of paragraph.elements) {
        text += extractParagraphElementText(paragraphElement)
      }
    } else if (isRecordLike(table) && Array.isArray(table.tableRows)) {
      for (const tableRow of table.tableRows) {
        if (!isRecordLike(tableRow) || !Array.isArray(tableRow.tableCells)) continue
        for (const tableCell of tableRow.tableCells) {
          if (isRecordLike(tableCell)) text += extractStructuralElementsText(tableCell.content)
        }
      }
    }
  }
  return text
}

/**
 * Extract the visible body text of a document (or a `DocumentTab`, which has
 * the same `body` shape): paragraphs, smart chips, and table cells
 * (including nested tables).
 */
export function extractTextFromDocument(document: unknown): string {
  if (!isRecordLike(document) || !isRecordLike(document.body)) return ''
  return extractStructuralElementsText(document.body.content)
}

export interface GoogleDocsTabContent {
  tabId: string | null
  title: string | null
  parentTabId: string | null
  index: number | null
  nestingLevel: number | null
  content: string
}

/**
 * Flatten a document's `tabs` tree (populated when `includeTabsContent=true`)
 * depth-first into one entry per tab with its extracted text.
 */
export function flattenDocumentTabs(tabs: unknown): GoogleDocsTabContent[] {
  if (!Array.isArray(tabs)) return []
  const out: GoogleDocsTabContent[] = []
  const visit = (list: unknown[]) => {
    for (const tab of list) {
      if (!isRecordLike(tab)) continue
      const props = toRecord(tab.tabProperties)
      out.push({
        tabId: readString(props.tabId) ?? null,
        title: readString(props.title) ?? null,
        parentTabId: readString(props.parentTabId) ?? null,
        index: typeof props.index === 'number' ? props.index : null,
        nestingLevel: typeof props.nestingLevel === 'number' ? props.nestingLevel : null,
        content: extractTextFromDocument(tab.documentTab),
      })
      if (Array.isArray(tab.childTabs)) visit(tab.childTabs)
    }
  }
  visit(tabs)
  return out
}
