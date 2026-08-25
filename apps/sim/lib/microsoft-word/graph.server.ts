import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { DOCX_MIME_TYPE } from '@/lib/microsoft-word/document.server'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { parseGraphErrorMessage } from '@/tools/microsoft_excel/utils'
import type { MicrosoftWordDocumentMetadata } from '@/tools/microsoft_word/types'

/** Microsoft Graph `driveItem` fields the Word routes project. */
interface GraphDriveItem {
  id?: string
  name?: string
  size?: number
  webUrl?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  /** An eTag for the item's content, unchanged when only metadata changes. */
  cTag?: string
  /** An eTag for the whole item, metadata included. */
  eTag?: string
  file?: { mimeType?: string }
  folder?: Record<string, unknown>
}

/**
 * The token that identifies the exact content an edit was based on.
 *
 * `cTag` is the right one: Graph documents it as "an eTag for the content of the
 * item" that does not move when only metadata changes, so a rename will not
 * spuriously abort an edit. `eTag` is the fallback for the shapes where Graph
 * omits `cTag`.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/driveitem
 */
export function getContentTag(item: GraphDriveItem): string | undefined {
  return item.cTag ?? item.eTag
}

/** Thrown when Microsoft Graph rejects a request, carrying its HTTP status. */
export class GraphRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GraphRequestError'
  }
}

/**
 * Issues an IP-pinned request to a Microsoft Graph URL, rejecting the URL when
 * DNS resolution points anywhere Sim must not reach.
 */
async function graphFetch(
  url: string,
  paramName: string,
  options: Parameters<typeof secureFetchWithPinnedIP>[2]
) {
  const validation = await validateUrlWithDNS(url, paramName)
  if (!validation.isValid) {
    throw new GraphRequestError(validation.error || `Invalid ${paramName}`, 400)
  }
  return secureFetchWithPinnedIP(url, validation.resolvedIP as string, options)
}

/** Reads a Graph error body and raises it as a {@link GraphRequestError}. */
async function raiseGraphError(response: {
  status: number
  statusText: string
  text: () => Promise<string>
}): Promise<never> {
  const errorText = await response.text().catch(() => '')
  throw new GraphRequestError(
    parseGraphErrorMessage(response.status, response.statusText, errorText),
    response.status
  )
}

/** Projects a Graph `driveItem` onto the metadata shape the Word tools return. */
export function toDocumentMetadata(
  item: GraphDriveItem,
  fallbackId: string
): MicrosoftWordDocumentMetadata {
  return {
    documentId: item.id ?? fallbackId,
    name: item.name ?? null,
    mimeType: item.file?.mimeType ?? null,
    webViewLink: item.webUrl ?? null,
    size: item.size ?? null,
    createdTime: item.createdDateTime ?? null,
    modifiedTime: item.lastModifiedDateTime ?? null,
  }
}

/**
 * Fetches a drive item's metadata and rejects folders, which have no document
 * content and would otherwise fail later with an opaque Graph error.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-get
 */
export async function fetchDocumentItem(
  basePath: string,
  accessToken: string
): Promise<GraphDriveItem> {
  const response = await graphFetch(basePath, 'documentUrl', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) await raiseGraphError(response)

  const item = (await response.json()) as GraphDriveItem
  if (item.folder && !item.file) {
    throw new GraphRequestError(
      `"${item.name ?? 'The selected item'}" is a folder, not a Word document`,
      400
    )
  }
  if (!isWordDocument(item)) {
    throw new GraphRequestError(
      `"${item.name ?? 'The selected item'}" is not a Word document. Every Microsoft Word operation reads or writes a .docx file.`,
      400
    )
  }
  return item
}

/**
 * Whether a drive item is a `.docx` package.
 *
 * The name suffix is accepted alongside the MIME type because Graph does not
 * always populate `file.mimeType`. Getting this wrong is destructive rather than
 * merely wrong: without the check, pointing Replace Content at a PDF would
 * overwrite it with generated WordprocessingML bytes.
 */
function isWordDocument(item: GraphDriveItem): boolean {
  return (
    item.file?.mimeType === DOCX_MIME_TYPE || Boolean(item.name?.toLowerCase().endsWith('.docx'))
  )
}

/**
 * Downloads a drive item's raw content.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
 */
export async function downloadDocumentContent(
  basePath: string,
  accessToken: string
): Promise<Buffer> {
  const response = await graphFetch(`${basePath}/content`, 'documentContentUrl', {
    headers: { Authorization: `Bearer ${accessToken}` },
    maxResponseBytes: MAX_FILE_SIZE,
    // Graph redirects to a short-lived preauthenticated URL on another host that
    // must not receive the bearer token.
    stripAuthOnRedirect: true,
  })

  if (!response.ok) await raiseGraphError(response)

  return Buffer.from(await response.arrayBuffer())
}

/**
 * Downloads a drive item converted to another format.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-get-content-format
 */
export async function downloadConvertedContent(
  basePath: string,
  accessToken: string,
  format: 'pdf'
): Promise<Buffer> {
  const response = await graphFetch(`${basePath}/content?format=${format}`, 'documentConvertUrl', {
    headers: { Authorization: `Bearer ${accessToken}` },
    maxResponseBytes: MAX_FILE_SIZE,
    stripAuthOnRedirect: true,
  })

  if (!response.ok) await raiseGraphError(response)

  return Buffer.from(await response.arrayBuffer())
}

/** Message shown when someone else changed the document mid-edit. */
const CONFLICT_MESSAGE =
  'The document changed in OneDrive or SharePoint after Sim read it, so the edit was not applied and no other change was overwritten. Run the operation again to edit the current version.'

/** Raised instead of overwriting a document that changed since it was read. */
export function documentChangedError(): GraphRequestError {
  return new GraphRequestError(CONFLICT_MESSAGE, 409)
}

/**
 * Aborts a read-modify-write when the document's content changed since it was
 * read. Without this, two overlapping edits both succeed and the later upload
 * silently discards the earlier one.
 *
 * `expected` being undefined means Graph returned neither tag for this item, so
 * there is nothing to compare and the caller proceeds unguarded — the
 * `if-match` header on the upload is the remaining line of defense.
 */
export async function assertContentUnchanged(
  basePath: string,
  accessToken: string,
  expected: string | undefined
): Promise<void> {
  if (!expected) return

  const current = getContentTag(await fetchDocumentItem(basePath, accessToken))
  if (current && current !== expected) {
    throw documentChangedError()
  }
}

/**
 * Uploads bytes as a drive item's content and returns the resulting item.
 *
 * `ifMatch` carries the content tag the upload is based on. Graph documents
 * `if-match` (and its `412 Precondition Failed` response) on the metadata
 * update, not on this content endpoint, so it is sent as a second line of
 * defense rather than the guarantee: an `If-Match` a server does not implement
 * is ignored, and the caller's {@link assertContentUnchanged} check is what
 * actually decides whether the write is safe. A `412` is surfaced as the same
 * conflict either way.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-update
 */
export async function uploadDocumentContent(
  url: string,
  accessToken: string,
  content: Buffer,
  mimeType: string,
  ifMatch?: string
): Promise<GraphDriveItem> {
  const response = await graphFetch(url, 'documentUploadUrl', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(content.length),
      ...(ifMatch ? { 'if-match': ifMatch } : {}),
    },
    body: content,
  })

  if (response.status === 412) {
    throw documentChangedError()
  }
  if (!response.ok) await raiseGraphError(response)

  return (await response.json()) as GraphDriveItem
}
