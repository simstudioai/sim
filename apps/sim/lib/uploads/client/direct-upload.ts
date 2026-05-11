import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { getFileContentType, isAbortError } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('DirectUpload')

const CHUNK_SIZE = 8 * 1024 * 1024
export const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024
const BASE_TIMEOUT_MS = 2 * 60 * 1000
const TIMEOUT_PER_MB_MS = 1500
const MAX_TIMEOUT_MS = 10 * 60 * 1000
export const MULTIPART_PART_CONCURRENCY = 3
export const MULTIPART_MAX_RETRIES = 3
export const MULTIPART_RETRY_DELAY_MS = 2000
export const MULTIPART_RETRY_BACKOFF = 2
export const WHOLE_FILE_PARALLEL_UPLOADS = 3

interface PresignedFileInfo {
  path: string
  key: string
  name: string
  size: number
  type: string
}

export interface PresignedUploadInfo {
  fileName: string
  presignedUrl: string
  fileInfo: PresignedFileInfo
  uploadHeaders?: Record<string, string>
  directUploadSupported: boolean
}

export interface UploadStrategyResult {
  key: string
  path: string
  name: string
  size: number
  contentType: string
}

export interface UploadProgressEvent {
  loaded: number
  total: number
  percent: number
}

export type DirectUploadErrorCode =
  | 'PRESIGNED_URL_ERROR'
  | 'DIRECT_UPLOAD_ERROR'
  | 'MULTIPART_ERROR'
  | 'ABORTED'
  | 'FALLBACK_REQUIRED'

export class DirectUploadError extends Error {
  constructor(
    message: string,
    public code: DirectUploadErrorCode,
    public details?: unknown,
    public status?: number
  ) {
    super(message)
    this.name = 'DirectUploadError'
  }
}

/**
 * Transport-level upload errors worth retrying at the outer level: timeouts,
 * network failures, and 5xx from the storage backend. Excludes deterministic
 * client failures (4xx, `PRESIGNED_URL_ERROR`, `FALLBACK_REQUIRED`) and aborts.
 */
export const isTransientUploadError = (error: unknown): boolean => {
  if (!(error instanceof DirectUploadError)) return false
  if (error.code !== 'DIRECT_UPLOAD_ERROR' && error.code !== 'MULTIPART_ERROR') return false
  if (error.status === undefined) return true
  return error.status >= 500 && error.status < 600
}

export const calculateUploadTimeoutMs = (fileSize: number): number => {
  const sizeInMb = fileSize / (1024 * 1024)
  const dynamicBudget = BASE_TIMEOUT_MS + sizeInMb * TIMEOUT_PER_MB_MS
  return Math.min(dynamicBudget, MAX_TIMEOUT_MS)
}

/**
 * Run `worker` over `items` with at most `limit` concurrent invocations.
 * Returns a settled result per item (never rejects), so callers can handle
 * partial failures explicitly.
 */
export const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> => {
  const results: Array<PromiseSettledResult<R>> = Array(items.length)
  if (items.length === 0) return results

  const concurrency = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = nextIndex++
      if (currentIndex >= items.length) break
      try {
        const value = await worker(items[currentIndex], currentIndex)
        results[currentIndex] = { status: 'fulfilled', value }
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error }
      }
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * Normalize a presigned-upload server response into a {@link PresignedUploadInfo}.
 * Accepts both single (`/api/files/presigned`) and batch entry shapes, tolerates
 * `presignedUrl` vs `uploadUrl` aliases, and short-circuits when the server
 * signals no cloud storage (`directUploadSupported: false`) so callers can fall
 * back to a server-proxied upload path.
 *
 * @throws {@link DirectUploadError} with code `PRESIGNED_URL_ERROR` if the
 * response is missing a presigned URL or `fileInfo.path`.
 */
export const normalizePresignedData = (data: unknown, context: string): PresignedUploadInfo => {
  const d = (data ?? {}) as Record<string, unknown>
  const presignedUrl = (d.presignedUrl as string) || (d.uploadUrl as string) || ''
  const fileInfo = d.fileInfo as Record<string, unknown> | undefined
  const directUploadSupported = d.directUploadSupported !== false

  if (!directUploadSupported) {
    return {
      fileName: (d.fileName as string) || context,
      presignedUrl: '',
      fileInfo: { path: '', key: '', name: context, size: 0, type: '' },
      directUploadSupported: false,
    }
  }

  if (!presignedUrl || !fileInfo?.path) {
    throw new DirectUploadError(
      `Invalid presigned response for ${context}`,
      'PRESIGNED_URL_ERROR',
      data
    )
  }

  return {
    fileName: (d.fileName as string) || (fileInfo.name as string) || context,
    presignedUrl,
    fileInfo: {
      path: fileInfo.path as string,
      key: (fileInfo.key as string) || '',
      name: (fileInfo.name as string) || context,
      size: (fileInfo.size as number) || (d.fileSize as number) || 0,
      type: (fileInfo.type as string) || (d.contentType as string) || '',
    },
    uploadHeaders: (d.uploadHeaders as Record<string, string>) || undefined,
    directUploadSupported: true,
  }
}

interface GetPresignedOptions {
  endpoint: string
  file: File
  signal?: AbortSignal
}

/**
 * Fetch a single presigned upload URL from a server endpoint that follows the
 * `{ presignedUrl, fileInfo, uploadHeaders?, directUploadSupported }` contract.
 */
export const getPresignedUploadInfo = async (
  opts: GetPresignedOptions
): Promise<PresignedUploadInfo> => {
  const { endpoint, file, signal } = opts
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: getFileContentType(file),
      fileSize: file.size,
    }),
    signal,
  })

  if (!response.ok) {
    let errorDetails: unknown = null
    try {
      errorDetails = await response.json()
    } catch {}
    const serverMessage =
      errorDetails != null &&
      typeof errorDetails === 'object' &&
      typeof (errorDetails as Record<string, unknown>).error === 'string'
        ? ((errorDetails as Record<string, unknown>).error as string)
        : null
    throw new DirectUploadError(
      serverMessage ||
        `Failed to get presigned URL for ${file.name}: ${response.status} ${response.statusText}`,
      'PRESIGNED_URL_ERROR',
      errorDetails
    )
  }

  return normalizePresignedData(await response.json(), file.name)
}

interface UploadViaPutOptions {
  file: File
  presignedUrl: string
  uploadHeaders?: Record<string, string>
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

const uploadViaPresignedPut = (opts: UploadViaPutOptions): Promise<void> => {
  const { file, presignedUrl, uploadHeaders, signal, onProgress } = opts

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let isCompleted = false
    const timeoutMs = calculateUploadTimeoutMs(file.size)

    const timeoutId = setTimeout(() => {
      if (isCompleted) return
      isCompleted = true
      signal?.removeEventListener('abort', abortHandler)
      xhr.abort()
      reject(new DirectUploadError(`Upload timeout for ${file.name}`, 'DIRECT_UPLOAD_ERROR'))
    }, timeoutMs)

    const abortHandler = () => {
      if (isCompleted) return
      isCompleted = true
      clearTimeout(timeoutId)
      xhr.abort()
      reject(new DirectUploadError(`Upload aborted for ${file.name}`, 'ABORTED'))
    }

    if (signal) {
      if (signal.aborted) {
        abortHandler()
        return
      }
      signal.addEventListener('abort', abortHandler)
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && !isCompleted) {
        onProgress?.({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        })
      }
    })

    xhr.addEventListener('load', () => {
      if (isCompleted) return
      isCompleted = true
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortHandler)

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size, percent: 100 })
        resolve()
      } else {
        reject(
          new DirectUploadError(
            `Direct upload failed for ${file.name}: ${xhr.status} ${xhr.statusText}`,
            'DIRECT_UPLOAD_ERROR',
            undefined,
            xhr.status
          )
        )
      }
    })

    xhr.addEventListener('error', () => {
      if (isCompleted) return
      isCompleted = true
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortHandler)
      reject(new DirectUploadError(`Network error uploading ${file.name}`, 'DIRECT_UPLOAD_ERROR'))
    })

    xhr.open('PUT', presignedUrl)
    xhr.setRequestHeader('Content-Type', getFileContentType(file))
    if (uploadHeaders) {
      for (const [key, value] of Object.entries(uploadHeaders)) {
        xhr.setRequestHeader(key, value)
      }
    }
    xhr.send(file)
  })
}

interface MultipartUploadOptions {
  file: File
  workspaceId: string
  context:
    | 'workspace'
    | 'knowledge-base'
    | 'mothership'
    | 'profile-pictures'
    | 'workspace-logos'
    | 'execution'
  workflowId?: string
  executionId?: string
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

interface CompletedPart {
  partNumber: number
  etag?: string
}

interface PartUrl {
  partNumber: number
  url: string
}

const uploadViaMultipart = async (
  opts: MultipartUploadOptions
): Promise<{ key: string; path: string }> => {
  const { file, workspaceId, context, workflowId, executionId, signal, onProgress } = opts

  // boundary-raw-fetch: multipart upload control plane uses action query strings; client lifecycle (initiate/get-part-urls/complete/abort) is sequenced manually and not modeled by a single contract
  const initiateResponse = await fetch('/api/files/multipart?action=initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: getFileContentType(file),
      fileSize: file.size,
      workspaceId,
      context,
      ...(workflowId ? { workflowId } : {}),
      ...(executionId ? { executionId } : {}),
    }),
    signal,
  })

  if (!initiateResponse.ok) {
    let errorBody: { error?: string } | null = null
    try {
      errorBody = (await initiateResponse.clone().json()) as { error?: string }
    } catch {}
    if (
      initiateResponse.status === 400 &&
      typeof errorBody?.error === 'string' &&
      errorBody.error.toLowerCase().includes('cloud storage')
    ) {
      throw new DirectUploadError(
        'Server signaled fallback to API upload',
        'FALLBACK_REQUIRED',
        errorBody
      )
    }
    throw new DirectUploadError(
      `Failed to initiate multipart upload: ${initiateResponse.statusText}`,
      'MULTIPART_ERROR',
      undefined,
      initiateResponse.status
    )
  }

  const { key, uploadToken } = (await initiateResponse.json()) as {
    uploadId: string
    key: string
    uploadToken: string
  }

  const numParts = Math.ceil(file.size / CHUNK_SIZE)
  const partNumbers = Array.from({ length: numParts }, (_, i) => i + 1)

  const abortMultipart = async () => {
    try {
      // boundary-raw-fetch: fire-and-forget abort during multipart cleanup; intentionally avoids contract response parsing so cleanup cannot mask the original error
      await fetch('/api/files/multipart?action=abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadToken }),
      })
    } catch (err) {
      logger.warn('Failed to abort multipart upload:', err)
    }
  }

  let presignedUrls: PartUrl[]
  try {
    // boundary-raw-fetch: multipart upload control plane uses action query strings; sequenced with initiate/complete/abort outside the contract layer
    const partUrlsResponse = await fetch('/api/files/multipart?action=get-part-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadToken, partNumbers }),
      signal,
    })

    if (!partUrlsResponse.ok) {
      throw new DirectUploadError(
        `Failed to get part URLs: ${partUrlsResponse.statusText}`,
        'MULTIPART_ERROR',
        undefined,
        partUrlsResponse.status
      )
    }

    ;({ presignedUrls } = (await partUrlsResponse.json()) as { presignedUrls: PartUrl[] })
  } catch (err) {
    await abortMultipart()
    throw err
  }

  const completedBytes = new Array<number>(numParts).fill(0)
  const reportProgress = () => {
    const loaded = completedBytes.reduce((a, b) => a + b, 0)
    onProgress?.({
      loaded,
      total: file.size,
      percent: Math.min(100, Math.round((loaded / file.size) * 100)),
    })
  }

  const uploadedParts: CompletedPart[] = []

  try {
    const uploadPart = async ({ partNumber, url }: PartUrl): Promise<CompletedPart> => {
      const start = (partNumber - 1) * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      for (let attempt = 0; attempt <= MULTIPART_MAX_RETRIES; attempt++) {
        try {
          const partResponse = await fetch(url, {
            method: 'PUT',
            body: chunk,
            signal,
            headers: { 'Content-Type': getFileContentType(file) },
          })

          if (!partResponse.ok) {
            throw new DirectUploadError(
              `Failed to upload part ${partNumber}: ${partResponse.statusText}`,
              'MULTIPART_ERROR',
              undefined,
              partResponse.status
            )
          }

          const etag = partResponse.headers.get('ETag') || undefined
          completedBytes[partNumber - 1] = end - start
          reportProgress()

          return { partNumber, etag: etag?.replace(/"/g, '') }
        } catch (partError) {
          const isClientError =
            partError instanceof DirectUploadError &&
            partError.status !== undefined &&
            partError.status >= 400 &&
            partError.status < 500
          if (isAbortError(partError) || isClientError || attempt >= MULTIPART_MAX_RETRIES) {
            throw partError
          }
          const delay = MULTIPART_RETRY_DELAY_MS * MULTIPART_RETRY_BACKOFF ** attempt
          logger.warn(
            `Part ${partNumber} failed (attempt ${attempt + 1}), retrying in ${Math.round(delay / 1000)}s`
          )
          await sleep(delay)
        }
      }

      throw new DirectUploadError(`Retries exhausted for part ${partNumber}`, 'MULTIPART_ERROR')
    }

    const partResults = await runWithConcurrency(
      presignedUrls,
      MULTIPART_PART_CONCURRENCY,
      uploadPart
    )

    for (const result of partResults) {
      if (result?.status === 'fulfilled') {
        uploadedParts.push(result.value)
      } else if (result?.status === 'rejected') {
        throw result.reason
      }
    }
  } catch (error) {
    await abortMultipart()
    throw error
  }

  let path: string
  try {
    // boundary-raw-fetch: multipart upload control plane uses action query strings; sequenced with initiate/get-part-urls/abort outside the contract layer
    const completeResponse = await fetch('/api/files/multipart?action=complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadToken, parts: uploadedParts }),
      signal,
    })

    if (!completeResponse.ok) {
      throw new DirectUploadError(
        `Failed to complete multipart upload: ${completeResponse.statusText}`,
        'MULTIPART_ERROR',
        undefined,
        completeResponse.status
      )
    }

    ;({ path } = (await completeResponse.json()) as { path: string })
  } catch (err) {
    await abortMultipart()
    throw err
  }
  return { key, path }
}

export interface RunUploadStrategyOptions {
  file: File
  workspaceId: string
  context:
    | 'workspace'
    | 'knowledge-base'
    | 'mothership'
    | 'profile-pictures'
    | 'workspace-logos'
    | 'execution'
  /** Endpoint to mint a presigned PUT URL. Required unless `presignedOverride` is provided. */
  presignedEndpoint?: string
  /** Pre-fetched presigned data (e.g. from a batch endpoint). Skips per-file fetch. */
  presignedOverride?: PresignedUploadInfo
  /** Required when context is `execution`; forwarded to the multipart route to scope the storage key. */
  workflowId?: string
  /** Required when context is `execution`; forwarded to the multipart route to scope the storage key. */
  executionId?: string
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
}

/**
 * Strategy ladder for client-side uploads:
 * - Files larger than {@link LARGE_FILE_THRESHOLD} use multipart S3/Blob with chunked PUTs.
 * - Smaller files use a presigned PUT URL (fetched per-file, or supplied via
 *   `presignedOverride` for batched flows like KB).
 * - If the server signals no cloud storage is configured, a {@link DirectUploadError}
 *   with code `FALLBACK_REQUIRED` is thrown so callers can fall back to a server-proxied path.
 */
export const runUploadStrategy = async (
  opts: RunUploadStrategyOptions
): Promise<UploadStrategyResult> => {
  const {
    file,
    presignedEndpoint,
    presignedOverride,
    workspaceId,
    context,
    workflowId,
    executionId,
    signal,
    onProgress,
  } = opts
  const contentType = getFileContentType(file)

  if (presignedOverride && !presignedOverride.directUploadSupported) {
    throw new DirectUploadError('Server signaled fallback to API upload', 'FALLBACK_REQUIRED')
  }

  if (file.size > LARGE_FILE_THRESHOLD) {
    const { key, path } = await uploadViaMultipart({
      file,
      workspaceId,
      context,
      workflowId,
      executionId,
      signal,
      onProgress,
    })
    return { key, path, name: file.name, size: file.size, contentType }
  }

  let presigned: PresignedUploadInfo
  if (presignedOverride) {
    presigned = presignedOverride
  } else {
    if (!presignedEndpoint) {
      throw new DirectUploadError(
        'runUploadStrategy requires either presignedEndpoint or presignedOverride',
        'PRESIGNED_URL_ERROR'
      )
    }
    presigned = await getPresignedUploadInfo({ endpoint: presignedEndpoint, file, signal })
  }

  if (!presigned.directUploadSupported) {
    throw new DirectUploadError('Server signaled fallback to API upload', 'FALLBACK_REQUIRED')
  }

  await uploadViaPresignedPut({
    file,
    presignedUrl: presigned.presignedUrl,
    uploadHeaders: presigned.uploadHeaders,
    signal,
    onProgress,
  })

  return {
    key: presigned.fileInfo.key,
    path: presigned.fileInfo.path,
    name: file.name,
    size: file.size,
    contentType,
  }
}
