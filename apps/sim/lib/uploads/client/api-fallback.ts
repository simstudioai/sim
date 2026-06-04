import type { StorageContext } from '@/lib/uploads/shared/types'

/**
 * Server-proxied fallback used only when cloud storage isn't configured (local dev).
 * Production always takes the presigned PUT path.
 */
export async function uploadViaApiFallback(
  file: File,
  context: StorageContext,
  workspaceId?: string
): Promise<{ path: string; key?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('context', context)
  if (workspaceId) {
    formData.append('workspaceId', workspaceId)
  }

  // boundary-raw-fetch: local-dev fallback when cloud storage is not configured; multipart upload incompatible with requestJson
  const response = await fetch('/api/files/upload', { method: 'POST', body: formData })
  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      message?: string
      error?: string
    }
    throw new Error(
      errorData.message || errorData.error || `Failed to upload file: ${response.status}`
    )
  }
  const data = (await response.json()) as {
    fileInfo?: { path?: string; key?: string }
    path?: string
    key?: string
    url?: string
  }
  const path = data.fileInfo?.path ?? data.path ?? data.url
  const key = data.fileInfo?.key ?? data.key
  if (!path) {
    throw new Error('Invalid upload response: missing path')
  }
  return { path, key }
}
