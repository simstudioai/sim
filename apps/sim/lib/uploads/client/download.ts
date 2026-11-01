import { PASTE_LIMITS, utf8ByteLength } from '@sim/utils/paste'
import { requestRaw } from '@/lib/api/client/request'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { exportWorkspaceFileSnapshotContract } from '@/lib/api/contracts/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { isMarkdownFile } from '@/lib/uploads/utils/file'
import { normalizeMimeType } from '@/lib/uploads/utils/mime'
import { servesStoredBytes } from '@/lib/workspace-files/stored-bytes'

/** Action-time content from the mounted viewer, scoped so another file cannot consume it. */
export interface FileDownloadSource {
  fileId: string
  workspaceId: string
  getContent: () => string | null
}

/**
 * Above this a stored file is handed to the browser's download manager instead of being read into
 * the page. Holding it as a `Blob` costs its whole size in tab memory and shows no progress until
 * the last byte lands; the download manager streams it to disk. Below it, and for a file the
 * server renders first (a page, a generated document), fetching keeps a rejection on screen
 * rather than as a failed entry in the browser's downloads list.
 */
const IN_PAGE_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024

function clickDownloadLink(href: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  // Attached before clicking: a detached anchor works in current browsers, but every
  // other download helper in the app attaches, and a silent no-op here would look
  // exactly like a download that never started.
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  clickDownloadLink(objectUrl, fileName)
  // Deferred: revoking synchronously after click() can race the download starting.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function fileNameFromDisposition(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // Fall through to the plain form.
    }
  }
  return disposition.match(/filename="([^"]+)"/)?.[1] ?? fallback
}

export async function triggerFileDownload(
  record: WorkspaceFileRecord,
  source?: FileDownloadSource | null
): Promise<void> {
  const isMarkdown = isMarkdownFile(record) || normalizeMimeType(record.type) === 'text/x-markdown'

  const content =
    isMarkdown &&
    record.vfsNamespace !== 'uploads' &&
    (record.storageContext ?? 'workspace') === 'workspace' &&
    source?.fileId === record.id &&
    source.workspaceId === record.workspaceId
      ? source.getContent()
      : null

  if (content !== null) {
    /** Source editing accepts larger drafts than the bounded image-bundling endpoint. */
    if (
      utf8ByteLength(content, PASTE_LIMITS.RICH_MARKDOWN_BYTES) > PASTE_LIMITS.RICH_MARKDOWN_BYTES
    ) {
      saveBlob(new Blob([content], { type: 'text/markdown; charset=utf-8' }), record.name)
      return
    }
    const response = await requestRaw(
      exportWorkspaceFileSnapshotContract,
      {
        params: { id: record.workspaceId, fileId: record.id },
        body: { content },
      },
      { cache: 'no-store' }
    )
    saveBlob(await response.blob(), fileNameFromDisposition(response, record.name))
    return
  }

  const exportsMarkdown =
    isMarkdown &&
    record.vfsNamespace !== 'uploads' &&
    (record.storageContext ?? 'workspace') === 'workspace'
  const url = exportsMarkdown
    ? `/api/files/export/${encodeURIComponent(record.id)}`
    : `/api/files/serve/${encodeURIComponent(record.key)}?context=${record.storageContext ?? 'workspace'}&t=${Date.now()}`

  if (
    !exportsMarkdown &&
    servesStoredBytes(record.type, record.name) &&
    record.size > IN_PAGE_DOWNLOAD_MAX_BYTES
  ) {
    // A first-byte read opens storage itself, so a missing object is refused here, in place,
    // rather than as a failed entry in the browser's downloads list.
    // boundary-raw-fetch: ranged probe of a binary path with no contract
    const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' })
    await probe.body?.cancel()
    if (!probe.ok) throw new Error(`Failed to download "${record.name}"`)
    clickDownloadLink(url, record.name)
    return
  }

  // boundary-raw-fetch: binary download read as a blob; these paths have no contract
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to download "${record.name}"`)

  saveBlob(await response.blob(), fileNameFromDisposition(response, record.name))
}

/**
 * Download a selection of files as a zip. Fetched rather than navigated to, so a
 * rejection — a document still compiling, an entry too large — surfaces as an error the
 * caller can show in place instead of replacing the page with raw JSON. `requestRaw`
 * throws an `ApiClientError` carrying the route's own message.
 */
export async function triggerArchiveDownload(input: {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
}): Promise<void> {
  const response = await requestRaw(
    downloadWorkspaceFileItemsContract,
    {
      params: { id: input.workspaceId },
      query: { fileIds: input.fileIds ?? [], folderIds: input.folderIds ?? [] },
    },
    { cache: 'no-store' }
  )

  saveBlob(await response.blob(), fileNameFromDisposition(response, 'workspace-files.zip'))
}
