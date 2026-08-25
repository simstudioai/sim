import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
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
  file?: { mimeType?: string }
  folder?: Record<string, unknown>
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
  return item
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

/**
 * Uploads bytes as a drive item's content and returns the resulting item.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
 */
export async function uploadDocumentContent(
  url: string,
  accessToken: string,
  content: Buffer,
  mimeType: string
): Promise<GraphDriveItem> {
  const response = await graphFetch(url, 'documentUploadUrl', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(content.length),
    },
    body: content,
  })

  if (!response.ok) await raiseGraphError(response)

  return (await response.json()) as GraphDriveItem
}
