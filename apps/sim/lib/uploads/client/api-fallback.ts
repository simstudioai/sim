import { isRecordLike } from '@sim/utils/object'
import type { StorageContext } from '@/lib/uploads/shared/types'

export interface ApiFallbackUploadOptions {
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export interface ApiFallbackUploadMetadata {
  path: string
  key?: string
  id?: string
  name?: string
  size?: number
  type?: string
  uploadedAt?: string
  expiresAt?: string
}

function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getUploadFailureReason(value: unknown, response: Response): string {
  if (isRecordLike(value)) {
    const message = getOptionalString(value.message) ?? getOptionalString(value.error)
    if (message) return message
  }

  return `Failed to upload file: ${response.status}`
}

function normalizeUploadMetadata(value: unknown): ApiFallbackUploadMetadata {
  if (!isRecordLike(value)) {
    throw new Error('Invalid upload response: expected file metadata')
  }

  const fileInfo = isRecordLike(value.fileInfo) ? value.fileInfo : undefined
  const path =
    getOptionalString(fileInfo?.path) ??
    getOptionalString(value.path) ??
    getOptionalString(value.url)
  if (!path) {
    throw new Error('Invalid upload response: missing path')
  }

  return {
    path,
    key: getOptionalString(fileInfo?.key) ?? getOptionalString(value.key),
    id: getOptionalString(fileInfo?.id) ?? getOptionalString(value.id),
    name:
      getOptionalString(fileInfo?.name) ??
      getOptionalString(value.name) ??
      getOptionalString(value.fileName),
    size: getOptionalNumber(fileInfo?.size) ?? getOptionalNumber(value.size),
    type: getOptionalString(fileInfo?.type) ?? getOptionalString(value.type),
    uploadedAt: getOptionalString(fileInfo?.uploadedAt) ?? getOptionalString(value.uploadedAt),
    expiresAt: getOptionalString(fileInfo?.expiresAt) ?? getOptionalString(value.expiresAt),
  }
}

async function parseUploadResponse(response: Response): Promise<ApiFallbackUploadMetadata> {
  if (!response.ok) {
    const errorData: unknown = await response.json().catch(() => null)
    throw new Error(getUploadFailureReason(errorData, response))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('Invalid upload response: response was not JSON')
  }

  const results = isRecordLike(data) && Array.isArray(data.files) ? data.files : [data]
  if (results.length === 0) {
    throw new Error('Invalid upload response: no files returned')
  }
  if (results.length > 1) {
    throw new Error('Invalid upload response: multiple files returned for a single-file upload')
  }

  return normalizeUploadMetadata(results[0])
}

/**
 * Uploads one file through the server-proxied multipart fallback and returns
 * normalized metadata for either the singular or `{ files: [...] }` response.
 */
export async function uploadViaApiFallbackWithMetadata(
  file: File,
  context: StorageContext,
  options: ApiFallbackUploadOptions = {}
): Promise<ApiFallbackUploadMetadata> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('context', context)
  if (options.workspaceId) {
    formData.append('workspaceId', options.workspaceId)
  }
  if (options.workflowId) {
    formData.append('workflowId', options.workflowId)
  }
  if (options.executionId) {
    formData.append('executionId', options.executionId)
  }

  // boundary-raw-fetch: local-dev fallback when cloud storage is not configured; multipart upload incompatible with requestJson
  const response = await fetch('/api/files/upload', { method: 'POST', body: formData })
  return parseUploadResponse(response)
}

/**
 * Server-proxied fallback used only when cloud storage isn't configured (local dev).
 * Production always takes the presigned PUT path.
 */
export async function uploadViaApiFallback(
  file: File,
  context: StorageContext,
  workspaceId?: string
): Promise<{ path: string; key?: string }> {
  const { path, key } = await uploadViaApiFallbackWithMetadata(file, context, { workspaceId })
  return { path, key }
}
