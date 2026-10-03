import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import {
  assertKnownSizeWithinLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { StorageContext } from '@/lib/uploads/config'
import { downloadFileStream, headObject } from '@/lib/uploads/core/storage-service'

const logger = createLogger('TikTokVideoUpload')

/** TikTok accepts 5-64 MB chunks and allows the final chunk to absorb the remainder. */
const DEFAULT_CHUNK_SIZE = 10_000_000
const MAX_UPLOAD_ATTEMPTS = 3
const ERROR_RESPONSE_MAX_BYTES = 64 * 1024

/**
 * Sim intentionally applies a lower relay ceiling than TikTok's provider limit. This bounds
 * request duration and the current-chunk retry buffer while uploads run in the web process.
 */
export const TIKTOK_MAX_VIDEO_BYTES = 250 * 1024 * 1024

export interface TikTokChunkPlan {
  chunkSize: number
  totalChunkCount: number
}

interface StoredFileOptions {
  key: string
  context: StorageContext
  signal: AbortSignal
}

interface StreamStoredVideoOptions extends StoredFileOptions {
  uploadUrl: string
  totalBytes: number
  mimeType: string
  requestId: string
}

function abortError(signal: AbortSignal): Error {
  return toError(signal.reason ?? new Error('Request aborted'))
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function bindStreamToAbort(stream: Readable, signal: AbortSignal): () => void {
  let handled = false
  const onAbort = () => {
    if (handled) return
    handled = true
    stream.destroy(abortError(signal))
  }
  if (signal.aborted) {
    onAbort()
  } else {
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  }
  return () => signal.removeEventListener('abort', onAbort)
}

async function sleepWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal)

  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    let handled = false
    onAbort = () => {
      if (handled) return
      handled = true
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })

  try {
    await Promise.race([sleep(delayMs), aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function normalizeStreamChunk(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array || typeof value === 'string') return Buffer.from(value)
  throw new Error('Storage returned an unsupported video stream chunk')
}

/** Computes TikTok's declared FILE_UPLOAD chunk layout without reading the file. */
export function computeTikTokChunkPlan(totalBytes: number): TikTokChunkPlan {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new Error('TikTok video size must be a positive safe integer')
  }

  if (totalBytes <= DEFAULT_CHUNK_SIZE) {
    return { chunkSize: totalBytes, totalChunkCount: 1 }
  }

  return {
    chunkSize: DEFAULT_CHUNK_SIZE,
    totalChunkCount: Math.floor(totalBytes / DEFAULT_CHUNK_SIZE),
  }
}

function validateStoredSize(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Storage returned an invalid video size')
  }
  assertKnownSizeWithinLimit(size, TIKTOK_MAX_VIDEO_BYTES, 'TikTok video upload')
  return size
}

async function countStoredFileBytes(options: StoredFileOptions): Promise<number> {
  throwIfAborted(options.signal)
  const stream = await downloadFileStream({ key: options.key, context: options.context })
  const unbindAbort = bindStreamToAbort(stream, options.signal)
  let totalBytes = 0

  try {
    for await (const value of stream) {
      throwIfAborted(options.signal)
      totalBytes += normalizeStreamChunk(value).byteLength
      assertKnownSizeWithinLimit(totalBytes, TIKTOK_MAX_VIDEO_BYTES, 'TikTok video upload')
    }
    throwIfAborted(options.signal)
    return validateStoredSize(totalBytes)
  } finally {
    unbindAbort()
    stream.destroy()
  }
}

/**
 * Resolves the authoritative object size. Cloud storage uses provider metadata; local storage
 * and providers without HEAD support are counted with a bounded, zero-accumulation pass.
 */
export async function getStoredVideoSize(options: StoredFileOptions): Promise<number> {
  throwIfAborted(options.signal)
  const metadata = await headObject(options.key, options.context)
  throwIfAborted(options.signal)

  return metadata ? validateStoredSize(metadata.size) : countStoredFileBytes(options)
}

class ExactStreamReader {
  private readonly iterator: AsyncIterator<unknown>
  private pending: Buffer | null = null
  private pendingOffset = 0

  constructor(stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]()
  }

  private async nextNonEmptyChunk(signal: AbortSignal): Promise<Buffer | null> {
    while (true) {
      throwIfAborted(signal)
      const next = await this.iterator.next()
      throwIfAborted(signal)
      if (next.done) return null
      const chunk = normalizeStreamChunk(next.value)
      if (chunk.byteLength > 0) return chunk
    }
  }

  async readExactly(byteLength: number, signal: AbortSignal): Promise<Buffer> {
    const output = Buffer.allocUnsafe(byteLength)
    let written = 0

    while (written < byteLength) {
      if (!this.pending || this.pendingOffset >= this.pending.byteLength) {
        this.pending = await this.nextNonEmptyChunk(signal)
        this.pendingOffset = 0
        if (!this.pending) {
          throw new Error(`Stored video ended early: expected ${byteLength - written} more byte(s)`)
        }
      }

      const available = this.pending.byteLength - this.pendingOffset
      const copyLength = Math.min(available, byteLength - written)
      this.pending.copy(output, written, this.pendingOffset, this.pendingOffset + copyLength)
      this.pendingOffset += copyLength
      written += copyLength
    }

    return output
  }

  async assertExhausted(signal: AbortSignal): Promise<void> {
    if (this.pending && this.pendingOffset < this.pending.byteLength) {
      throw new Error('Stored video grew after its size was resolved')
    }
    if (await this.nextNonEmptyChunk(signal)) {
      throw new Error('Stored video grew after its size was resolved')
    }
  }

  async close(): Promise<void> {
    await this.iterator.return?.()
  }
}

async function readUploadResponse(response: Response, signal: AbortSignal): Promise<string> {
  try {
    return await readResponseTextWithLimit(response, {
      maxBytes: ERROR_RESPONSE_MAX_BYTES,
      label: 'TikTok upload response',
      signal,
    })
  } catch {
    throwIfAborted(signal)
    return 'Response body exceeded the allowed size'
  }
}

async function uploadChunk(options: {
  uploadUrl: string
  chunk: Buffer
  chunkIndex: number
  totalChunkCount: number
  start: number
  end: number
  totalBytes: number
  mimeType: string
  requestId: string
  signal: AbortSignal
}): Promise<void> {
  const expectedStatus = options.chunkIndex === options.totalChunkCount - 1 ? 201 : 206

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    throwIfAborted(options.signal)
    const response = await fetch(options.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': options.mimeType,
        'Content-Length': String(options.chunk.byteLength),
        'Content-Range': `bytes ${options.start}-${options.end}/${options.totalBytes}`,
      },
      body: new Uint8Array(options.chunk),
      signal: options.signal,
    })

    if (response.status === expectedStatus) {
      await readUploadResponse(response, options.signal)
      return
    }

    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    const errorText = await readUploadResponse(response, options.signal)
    const retryable = response.status >= 500 && response.status <= 599

    if (retryable && attempt < MAX_UPLOAD_ATTEMPTS) {
      logger.warn(`[${options.requestId}] Retrying TikTok video chunk`, {
        chunkIndex: options.chunkIndex,
        attempt,
        status: response.status,
      })
      await sleepWithAbort(backoffWithJitter(attempt, retryAfterMs), options.signal)
      continue
    }

    throw new Error(
      `TikTok rejected video chunk ${options.chunkIndex + 1}/${options.totalChunkCount}: expected HTTP ${expectedStatus}, received HTTP ${response.status}${errorText ? ` ${errorText}` : ''}`
    )
  }
}

/**
 * Streams a stored video into TikTok sequentially. Only the current provider chunk is retained,
 * so retry memory is bounded independently of total file size.
 */
export async function streamStoredVideoToTikTok(options: StreamStoredVideoOptions): Promise<void> {
  const plan = computeTikTokChunkPlan(options.totalBytes)
  throwIfAborted(options.signal)
  const stream = await downloadFileStream({ key: options.key, context: options.context })
  const unbindAbort = bindStreamToAbort(stream, options.signal)
  const reader = new ExactStreamReader(stream)

  try {
    for (let chunkIndex = 0; chunkIndex < plan.totalChunkCount; chunkIndex++) {
      const start = chunkIndex * plan.chunkSize
      const isLastChunk = chunkIndex === plan.totalChunkCount - 1
      const end = isLastChunk ? options.totalBytes - 1 : start + plan.chunkSize - 1
      const chunk = await reader.readExactly(end - start + 1, options.signal)
      if (isLastChunk) await reader.assertExhausted(options.signal)

      await uploadChunk({
        uploadUrl: options.uploadUrl,
        chunk,
        chunkIndex,
        totalChunkCount: plan.totalChunkCount,
        start,
        end,
        totalBytes: options.totalBytes,
        mimeType: options.mimeType,
        requestId: options.requestId,
        signal: options.signal,
      })
    }
  } finally {
    unbindAbort()
    stream.destroy()
    await reader.close().catch(() => {})
  }
}
