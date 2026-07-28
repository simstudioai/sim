import { requestRaw } from '@/lib/api/client/request'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
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

export async function triggerFileDownload(record: WorkspaceFileRecord): Promise<void> {
  const isMarkdown =
    record.type === 'text/markdown' ||
    record.type === 'text/x-markdown' ||
    /\.(?:md|markdown)$/i.test(record.name)

  const url = isMarkdown
    ? `/api/files/export/${encodeURIComponent(record.id)}`
    : `/api/files/serve/${encodeURIComponent(record.key)}?context=workspace&t=${Date.now()}`

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
