import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

/** Hand a fetched blob to the browser as a file save, then release the object URL. */
function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(objectUrl)
}

function fileNameFromDisposition(response: Response, fallback: string): string {
  return response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallback
}

/**
 * Read the server's error copy off a failed download so the caller can surface it.
 * These routes answer with `{ error }` and the message is written for the user —
 * which document is still compiling, which entry is too large.
 */
async function downloadErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json()
    return typeof body?.error === 'string' && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}

export async function triggerFileDownload(record: WorkspaceFileRecord): Promise<void> {
  const isMarkdown =
    record.type === 'text/markdown' ||
    record.type === 'text/x-markdown' ||
    /\.(?:md|markdown)$/i.test(record.name)

  const url = isMarkdown
    ? `/api/files/export/${encodeURIComponent(record.id)}`
    : `/api/files/serve/${encodeURIComponent(record.key)}?context=workspace&t=${Date.now()}`

  // boundary-raw-fetch: binary download read as a blob, not a JSON contract response
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(await downloadErrorMessage(response, `Failed to download "${record.name}"`))
  }

  saveBlob(await response.blob(), fileNameFromDisposition(response, record.name))
}

/**
 * Download a multi-file selection as a zip. Fetched rather than navigated to, so a
 * rejection — a document still compiling, an entry too large — surfaces as an error
 * the caller can show in place instead of replacing the page with raw JSON.
 */
export async function triggerArchiveDownload(url: string): Promise<void> {
  // boundary-raw-fetch: binary zip download read as a blob, not a JSON contract response
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(await downloadErrorMessage(response, 'Failed to download the selected files'))
  }

  saveBlob(await response.blob(), fileNameFromDisposition(response, 'workspace-files.zip'))
}
