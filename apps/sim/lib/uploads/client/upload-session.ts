import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import type {
  V2MultipartUploadTransfer,
  V2PutUploadTransfer,
  V2UploadPartUrl,
} from '@/lib/api/contracts/v2/uploads'
import { runWithConcurrency } from '@/lib/uploads/client/concurrency'
import type { UploadProgressEvent } from '@/lib/uploads/client/types'
import { isAbortError } from '@/lib/uploads/utils/file-utils'

const BASE_TIMEOUT_MS = 2 * 60 * 1000
const TIMEOUT_PER_MB_MS = 1500
const MAX_TIMEOUT_MS = 10 * 60 * 1000
const PART_URL_BATCH_SIZE = 25
const PART_UPLOAD_CONCURRENCY = 3
const MAX_RETRIES = 3
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 8000

const logger = createLogger('UploadSessionClient')

export function calculateUploadTimeoutMs(fileSize: number): number {
  const sizeInMb = fileSize / (1024 * 1024)
  return Math.min(BASE_TIMEOUT_MS + sizeInMb * TIMEOUT_PER_MB_MS, MAX_TIMEOUT_MS)
}

export class UploadSessionTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs: number | null = null,
    readonly transient = false
  ) {
    super(message)
    this.name = 'UploadSessionTransportError'
  }
}

interface UploadFileSessionCommon<T> {
  file: File
  signal?: AbortSignal
  onProgress?: (event: UploadProgressEvent) => void
  complete: () => Promise<T>
  abort: () => Promise<void>
}

interface UploadPutFileSession<T> extends UploadFileSessionCommon<T> {
  transfer: V2PutUploadTransfer
  getPartUrls?: never
}

interface UploadMultipartFileSession<T> extends UploadFileSessionCommon<T> {
  transfer: V2MultipartUploadTransfer
  getPartUrls: (partNumbers: number[]) => Promise<V2UploadPartUrl[]>
}

export type UploadFileSessionParams<T> = UploadPutFileSession<T> | UploadMultipartFileSession<T>

function isPutFileSession<T>(
  params: UploadFileSessionParams<T>
): params is UploadPutFileSession<T> {
  return params.transfer.method === 'put'
}

export async function uploadFileSession<T>(params: UploadFileSessionParams<T>): Promise<T> {
  try {
    if (isPutFileSession(params)) {
      await uploadPut(params)
    } else {
      await uploadMultipart(params)
    }
  } catch (error) {
    await params.abort().catch((abortError) => {
      logger.warn('Failed to abort upload session after an upload error', {
        error: getErrorMessage(abortError),
      })
    })
    throw error
  }

  return params.complete()
}

async function uploadPut<T>(params: UploadPutFileSession<T>): Promise<void> {
  let reportedLoaded = 0
  const reportProgress = (loaded: number) => {
    reportedLoaded = Math.max(reportedLoaded, loaded)
    params.onProgress?.({
      loaded: reportedLoaded,
      total: params.file.size,
      percent:
        params.file.size === 0
          ? 100
          : Math.min(100, Math.round((reportedLoaded / params.file.size) * 100)),
    })
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await uploadPutAttempt({
        file: params.file,
        transfer: params.transfer,
        signal: params.signal,
        onProgress: reportProgress,
      })
      reportProgress(params.file.size)
      return
    } catch (error) {
      if (attempt > 0 && isCreateOnlyConflict(error)) {
        reportProgress(params.file.size)
        return
      }
      if (isAbortError(error) || !isRetryableUploadError(error) || attempt >= MAX_RETRIES) {
        throw error
      }
      await waitForRetry(attempt + 1, error.retryAfterMs, params.file.name, params.signal)
    }
  }
  throw new Error(`PUT upload retries exhausted for ${params.file.name}`)
}

interface UploadPutAttemptParams {
  file: File
  transfer: V2PutUploadTransfer
  signal?: AbortSignal
  onProgress: (loaded: number) => void
}

function uploadPutAttempt(params: UploadPutAttemptParams): Promise<void> {
  if (params.signal?.aborted) return Promise.reject(uploadAbortError(params.file.name))

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false

    const cleanup = () => {
      params.signal?.removeEventListener('abort', handleSignalAbort)
      xhr.upload.removeEventListener('progress', handleProgress)
      xhr.removeEventListener('load', handleLoad)
      xhr.removeEventListener('error', handleError)
      xhr.removeEventListener('timeout', handleTimeout)
    }

    const resolveOnce = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const handleSignalAbort = () => {
      xhr.abort()
      rejectOnce(uploadAbortError(params.file.name))
    }

    const handleProgress = (event: ProgressEvent<EventTarget>) => {
      if (event.lengthComputable && !settled) params.onProgress(event.loaded)
    }

    const handleLoad = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolveOnce()
        return
      }
      rejectOnce(
        new UploadSessionTransportError(
          `PUT upload failed for ${params.file.name}: ${xhr.status} ${xhr.statusText}`,
          xhr.status,
          parseRetryAfter(xhr.getResponseHeader('Retry-After'), RETRY_MAX_MS),
          isRetryableStatus(xhr.status)
        )
      )
    }

    const handleError = () => {
      rejectOnce(
        new UploadSessionTransportError(
          `Network error uploading ${params.file.name}`,
          undefined,
          null,
          true
        )
      )
    }

    const handleTimeout = () => {
      rejectOnce(
        new UploadSessionTransportError(
          `Upload timed out for ${params.file.name}`,
          undefined,
          null,
          true
        )
      )
    }

    xhr.open('PUT', params.transfer.url)
    xhr.timeout = calculateUploadTimeoutMs(params.file.size)
    for (const [key, value] of Object.entries(params.transfer.headers)) {
      xhr.setRequestHeader(key, value)
    }
    xhr.upload.addEventListener('progress', handleProgress)
    xhr.addEventListener('load', handleLoad)
    xhr.addEventListener('error', handleError)
    xhr.addEventListener('timeout', handleTimeout)
    params.signal?.addEventListener('abort', handleSignalAbort, { once: true })
    xhr.send(params.file)
  })
}

async function uploadMultipart<T>(params: UploadMultipartFileSession<T>): Promise<void> {
  const { file, transfer, signal, onProgress } = params
  const expectedPartCount = Math.ceil(file.size / transfer.partSize)
  if (expectedPartCount !== transfer.partCount) {
    throw new Error(
      `Upload session expected ${transfer.partCount} parts, but file requires ${expectedPartCount}`
    )
  }

  const completedBytes = new Array<number>(transfer.partCount).fill(0)
  for (let start = 1; start <= transfer.partCount; start += PART_URL_BATCH_SIZE) {
    const partNumbers = Array.from(
      { length: Math.min(PART_URL_BATCH_SIZE, transfer.partCount - start + 1) },
      (_, index) => start + index
    )
    const partUrls = validatePartUrlBatch(partNumbers, await params.getPartUrls(partNumbers))
    const results = await runWithConcurrency(
      partUrls,
      PART_UPLOAD_CONCURRENCY,
      async (part): Promise<void> => {
        const partStart = (part.partNumber - 1) * transfer.partSize
        const end = Math.min(partStart + transfer.partSize, file.size)
        const chunk = file.slice(partStart, end)
        await uploadMultipartPart({ part, chunk, fileName: file.name, signal })
        completedBytes[part.partNumber - 1] = end - partStart
        const loaded = completedBytes.reduce((sum, bytes) => sum + bytes, 0)
        onProgress?.({
          loaded,
          total: file.size,
          percent: Math.min(100, Math.round((loaded / file.size) * 100)),
        })
      }
    )
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  }
}

function validatePartUrlBatch(requested: number[], received: V2UploadPartUrl[]): V2UploadPartUrl[] {
  if (received.length !== requested.length) {
    throw new Error(`Expected ${requested.length} part URLs; received ${received.length}`)
  }
  const byPartNumber = new Map<number, V2UploadPartUrl>()
  for (const part of received) {
    if (byPartNumber.has(part.partNumber)) {
      throw new Error(`Received duplicate URL for part ${part.partNumber}`)
    }
    byPartNumber.set(part.partNumber, part)
  }
  return requested.map((partNumber) => {
    const part = byPartNumber.get(partNumber)
    if (!part) throw new Error(`Missing upload URL for part ${partNumber}`)
    return part
  })
}

async function uploadMultipartPart(params: {
  part: V2UploadPartUrl
  chunk: Blob
  fileName: string
  signal?: AbortSignal
}): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // boundary-raw-fetch: signed multipart data-plane URL may target cloud storage or local Sim
      const response = await fetch(params.part.url, {
        method: 'PUT',
        body: params.chunk,
        headers: params.part.headers,
        signal: params.signal,
      })
      if (!response.ok) {
        throw new UploadSessionTransportError(
          `Part ${params.part.partNumber} failed (${response.status})`,
          response.status,
          parseRetryAfter(response.headers.get('Retry-After'), RETRY_MAX_MS),
          isRetryableStatus(response.status)
        )
      }
      return
    } catch (error) {
      if (isAbortError(error)) throw error
      const classified =
        error instanceof TypeError
          ? new UploadSessionTransportError(
              `Network error uploading part ${params.part.partNumber}`,
              undefined,
              null,
              true
            )
          : error
      if (!isRetryableUploadError(classified) || attempt >= MAX_RETRIES) {
        throw classified
      }
      await waitForRetry(attempt + 1, classified.retryAfterMs, params.fileName, params.signal)
    }
  }
  throw new Error(`Part ${params.part.partNumber} upload retries exhausted`)
}

function isRetryableUploadError(error: unknown): error is UploadSessionTransportError {
  return error instanceof UploadSessionTransportError && error.transient
}

/**
 * Whether a retried whole-object PUT was rejected by the create-only
 * precondition every provider signs into the transfer (S3/GCS `412`, Azure
 * `409`). After a first attempt whose response was lost, that conflict means
 * our own bytes are already committed, so the transfer is treated as finished
 * and completion verifies the object's upload id, size, and content type
 * server-side before anything durable is registered.
 */
function isCreateOnlyConflict(error: unknown): boolean {
  return (
    error instanceof UploadSessionTransportError && (error.status === 409 || error.status === 412)
  )
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600)
}

async function waitForRetry(
  attempt: number,
  retryAfterMs: number | null,
  fileName: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw uploadAbortError(fileName)
  const delay = backoffWithJitter(attempt, retryAfterMs, {
    baseMs: RETRY_BASE_MS,
    maxMs: RETRY_MAX_MS,
  })
  if (!signal) {
    await sleep(delay)
    return
  }
  await new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener('abort', handleAbort)
      reject(uploadAbortError(fileName))
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    sleep(delay).then(
      () => {
        signal.removeEventListener('abort', handleAbort)
        resolve()
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort)
        reject(error)
      }
    )
  })
}

function uploadAbortError(fileName: string): DOMException {
  return new DOMException(`Upload aborted for ${fileName}`, 'AbortError')
}
