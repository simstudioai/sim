import { requestRaw } from '@/lib/api/client/request'
import { fileExportContract } from '@/lib/api/contracts/storage-transfer'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'

export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  // Attached before clicking: a detached anchor works in current browsers, but every
  // other download helper in the app attaches, and a silent no-op here would look
  // exactly like a download that never started.
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
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
  options?: { format?: 'pdf' }
): Promise<void> {
  const isMarkdown = isMarkdownFile(record)

  if (options?.format === 'pdf' && !isMarkdown) {
    throw new Error('PDF export is only available for Markdown files')
  }

  let response: Response
  if (isMarkdown) {
    response = await requestRaw(
      fileExportContract,
      { params: { id: record.id }, query: { format: options?.format } },
      { cache: 'no-store' }
    )
  } else {
    const url = `/api/files/serve/${encodeURIComponent(record.key)}?context=workspace&t=${Date.now()}`
    // boundary-raw-fetch: legacy binary serve URL includes context and cache-busting query fields outside the serve contract
    response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Failed to download "${record.name}"`)
  }

  const fallbackName =
    options?.format === 'pdf' ? `${record.name.replace(/\.[^.]+$/, '')}.pdf` : record.name
  saveBlob(await response.blob(), fileNameFromDisposition(response, fallbackName))
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
