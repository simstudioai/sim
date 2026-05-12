import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

export async function triggerFileDownload(record: WorkspaceFileRecord): Promise<void> {
  const isMarkdown =
    record.type === 'text/markdown' ||
    record.type === 'text/x-markdown' ||
    /\.(?:md|markdown)$/i.test(record.name)

  const url = isMarkdown
    ? `/api/files/export/${encodeURIComponent(record.id)}`
    : `/api/files/serve/${encodeURIComponent(record.key)}?context=workspace&t=${Date.now()}`

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`)

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download =
    response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? record.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}
