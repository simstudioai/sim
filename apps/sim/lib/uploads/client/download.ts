import { PASTE_LIMITS, utf8ByteLength } from '@sim/utils/paste'
import { contractUrl, requestJson, requestRaw } from '@/lib/api/client/request'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  downloadWorkspaceFileStreamContract,
  exportWorkspaceFileSnapshotContract,
  readWorkspaceFileContract,
} from '@/lib/api/contracts/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  isMarkdownFile,
  needsRenderedArtifact,
  SIM_PAGE_CONTENT_TYPE,
} from '@/lib/uploads/utils/file-utils'

/** Action-time content from the mounted viewer, scoped so another file cannot consume it. */
export interface FileDownloadSource {
  fileId: string
  workspaceId: string
  getContent: () => string | null
}

export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  downloadUrl(objectUrl, fileName)
  /** Revoking synchronously can race the browser starting the download. */
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function downloadUrl(url: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
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

function isMarkdownDownload(record: WorkspaceFileRecord): boolean {
  return isMarkdownFile(record) || record.type === 'text/x-markdown'
}

function needsPageRendering(record: WorkspaceFileRecord): boolean {
  return record.type === SIM_PAGE_CONTENT_TYPE || record.name.toLowerCase().endsWith('.html')
}

export async function triggerFileDownload(
  record: WorkspaceFileRecord,
  source?: FileDownloadSource | null
): Promise<void> {
  const isMarkdown = isMarkdownDownload(record)

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

  if (
    !isMarkdown &&
    !needsPageRendering(record) &&
    record.vfsNamespace !== 'uploads' &&
    (record.storageContext ?? 'workspace') === 'workspace'
  ) {
    const input = { params: { id: record.workspaceId, fileId: record.id } }
    /** Surface access errors before handing an ordinary download to the browser. */
    const { file } = await requestJson(readWorkspaceFileContract, input)
    if (
      needsPageRendering(file) ||
      isMarkdownDownload(file) ||
      needsRenderedArtifact(file.type, file.name)
    ) {
      /** Transformed exports retain their existing limits and in-app failure handling. */
      await downloadStoredFile(file)
    } else {
      downloadUrl(contractUrl(downloadWorkspaceFileStreamContract, input), file.name)
    }
    return
  }

  await downloadStoredFile(record)
}

async function downloadStoredFile(record: WorkspaceFileRecord): Promise<void> {
  const url =
    isMarkdownDownload(record) &&
    record.vfsNamespace !== 'uploads' &&
    (record.storageContext ?? 'workspace') === 'workspace'
      ? `/api/files/export/${encodeURIComponent(record.id)}`
      : `/api/files/serve/${encodeURIComponent(record.key)}?context=${record.storageContext ?? 'workspace'}&t=${Date.now()}`

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
