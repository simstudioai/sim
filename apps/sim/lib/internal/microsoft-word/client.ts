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
  options: Omit<NonNullable<Parameters<typeof secureFetchWithPinnedIP>[2]>, 'profile'>
) {
  options.signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(url, paramName, 'configuredEndpoint')
  options.signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new GraphRequestError(validation.error || `Invalid ${paramName}`, 400)
  }
  return secureFetchWithPinnedIP(url, validation.resolvedIP as string, {
    ...options,
    profile: 'configuredEndpoint',
  })
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
  accessToken: string,
  signal?: AbortSignal
): Promise<GraphDriveItem> {
  const response = await graphFetch(basePath, 'documentUrl', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
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
  accessToken: string,
  signal?: AbortSignal
): Promise<Buffer> {
  const response = await graphFetch(`${basePath}/content`, 'documentContentUrl', {
    headers: { Authorization: `Bearer ${accessToken}` },
    maxResponseBytes: MAX_FILE_SIZE,
    signal,
    /** Graph redirects to a preauthenticated host that must not receive the bearer token. */
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
  format: 'pdf',
  signal?: AbortSignal
): Promise<Buffer> {
  const response = await graphFetch(`${basePath}/content?format=${format}`, 'documentConvertUrl', {
    headers: { Authorization: `Bearer ${accessToken}` },
    maxResponseBytes: MAX_FILE_SIZE,
    signal,
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

/** Message shown when the document carries no version to compare against. */
const UNVERIFIABLE_MESSAGE =
  'Microsoft Graph did not report a version for this document, so Sim cannot confirm the edit would not overwrite someone else’s change and did not apply it. Use Replace Content if you intend to overwrite the document outright.'

/**
 * Raised when there is no version to compare, rather than writing unguarded.
 *
 * Graph returns `cTag` for every file and `eTag` for every drive item, so this
 * should not be reachable in practice — but a read-modify-write that silently
 * degrades to no protection is the failure this whole guard exists to prevent,
 * so the missing-version path fails closed instead of proceeding.
 */
function unverifiableDocumentError(): GraphRequestError {
  return new GraphRequestError(UNVERIFIABLE_MESSAGE, 409)
}

/**
 * Returns the content tag an edit must be based on, refusing the edit outright
 * when the item carries none.
 */
export function requireContentTag(item: GraphDriveItem): string {
  const tag = getContentTag(item)
  if (!tag) {
    throw unverifiableDocumentError()
  }
  return tag
}

/** A Graph upload session, used for a precondition-checked content write. */
interface GraphUploadSession {
  uploadUrl?: string
}

/**
 * Replaces a document's content only if it still matches `expectedTag`.
 *
 * `PUT /items/{id}/content` documents no precondition — its request-headers
 * table lists only `Authorization` and `Content-Type` — so a conditional write
 * has to go through an upload session, whose `if-match` header Graph documents
 * as returning `412 Precondition Failed` on a mismatch. That makes the check
 * service-enforced rather than a client-side compare that could itself race.
 *
 * The residual window is small and stated honestly: the tag is evaluated when
 * the session is created and the bytes commit on the following request. Closing
 * it completely would need the deferred-commit form, whose conditional commit
 * relies on `@microsoft.graph.sourceUrl` — which Microsoft documents as
 * unsupported on OneDrive for Business and SharePoint Online, where these
 * documents live.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession
 * @see https://learn.microsoft.com/en-us/graph/api/resources/driveitem
 */
export async function replaceContentIfUnchanged(
  basePath: string,
  accessToken: string,
  content: Buffer,
  expectedTag: string,
  signal?: AbortSignal
): Promise<GraphDriveItem> {
  const sessionResponse = await graphFetch(
    `${basePath}/createUploadSession`,
    'documentUploadSessionUrl',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'if-match': expectedTag,
      },
      body: '{}',
      signal,
    }
  )

  if (sessionResponse.status === 412) {
    throw documentChangedError()
  }
  if (!sessionResponse.ok) await raiseGraphError(sessionResponse)

  const { uploadUrl } = (await sessionResponse.json()) as GraphUploadSession
  if (!uploadUrl) {
    throw new GraphRequestError('Microsoft Graph did not return an upload URL', 502)
  }

  return uploadSessionBytes(uploadUrl, content, signal)
}

/**
 * Byte size of each upload fragment.
 *
 * Graph caps a single upload request below 60 MiB, and requires every fragment
 * of a split upload to be a multiple of 320 KiB — 10 MiB is both (327,680 × 32)
 * and is inside the 5–10 MiB range Microsoft recommends. Documents are read
 * under a 100 MB ceiling, so a single request would not always be enough.
 */
const UPLOAD_FRAGMENT_BYTES = 10 * 1024 * 1024

/**
 * Sends the package to a session's upload URL, splitting it into sequential
 * fragments. Graph answers `202 Accepted` for every fragment but the last, and
 * returns the finished driveItem with the one that completes the file.
 *
 * The URL is preauthenticated and on another host; Graph documents that sending
 * `Authorization` here can itself fail the request with a 401, so no bearer
 * token is attached.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession
 */
async function uploadSessionBytes(
  uploadUrl: string,
  content: Buffer,
  signal?: AbortSignal
): Promise<GraphDriveItem> {
  const total = content.length

  for (let start = 0; start < total; start += UPLOAD_FRAGMENT_BYTES) {
    const end = Math.min(start + UPLOAD_FRAGMENT_BYTES, total) - 1
    const fragment = content.subarray(start, end + 1)

    const response = await graphFetch(uploadUrl, 'documentUploadUrl', {
      method: 'PUT',
      headers: {
        'Content-Length': String(fragment.length),
        'Content-Range': `bytes ${start}-${end}/${total}`,
      },
      body: fragment,
      signal,
    })

    if (response.status === 412 || response.status === 409) {
      throw documentChangedError()
    }
    if (!response.ok) await raiseGraphError(response)

    /** Every fragment but the last is acknowledged with 202 and no item body. */
    if (end === total - 1) {
      return (await response.json()) as GraphDriveItem
    }
  }

  throw new GraphRequestError('Microsoft Graph did not complete the document upload', 502)
}

/**
 * Uploads bytes as a drive item's content and returns the resulting item.
 *
 * Unconditional by design: this backs creating a new document and the
 * deliberate whole-document overwrite. An edit that must not clobber a
 * concurrent change uses {@link replaceContentIfUnchanged} instead.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
 */
export async function uploadDocumentContent(
  url: string,
  accessToken: string,
  content: Buffer,
  mimeType: string,
  signal?: AbortSignal
): Promise<GraphDriveItem> {
  const response = await graphFetch(url, 'documentUploadUrl', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(content.length),
    },
    body: content,
    signal,
  })

  if (!response.ok) await raiseGraphError(response)

  return (await response.json()) as GraphDriveItem
}
