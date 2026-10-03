import {
  assertKnownSizeWithinLimit,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const MAX_ATTACHMENT_METADATA_BYTES = 10 * 1024 * 1024

/** A shared byte budget for sequential attachment downloads in one tool call. */
export class AttachmentDownloadBudget {
  private downloadedBytes = 0
  readonly signal?: AbortSignal
  private readonly maxBytes: number

  constructor(options: { signal?: AbortSignal; maxBytes?: number } = {}) {
    this.signal = options.signal
    this.maxBytes = options.maxBytes ?? MAX_BUFFERED_TRANSFER_BYTES
  }

  get remainingBytes(): number {
    return this.maxBytes - this.downloadedBytes
  }

  assertSize(size: number, label: string, maxFileBytes = this.maxBytes): void {
    this.signal?.throwIfAborted()
    assertKnownSizeWithinLimit(size, Math.min(this.remainingBytes, maxFileBytes), label)
  }

  consume(buffer: Buffer, label: string): Buffer {
    this.assertSize(buffer.byteLength, label)
    this.downloadedBytes += buffer.byteLength
    return buffer
  }

  async read(response: Response, label: string, maxFileBytes = this.maxBytes): Promise<Buffer> {
    this.signal?.throwIfAborted()
    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: Math.min(this.remainingBytes, maxFileBytes),
      label,
      signal: this.signal,
    })
    return this.consume(buffer, label)
  }
}

/** Provider metadata and error bodies remain bounded independently of file content. */
export async function readAttachmentJson<T>(
  response: Response,
  label: string,
  signal?: AbortSignal,
  maxBytes = MAX_ATTACHMENT_METADATA_BYTES
): Promise<T> {
  signal?.throwIfAborted()
  const text = await readResponseTextWithLimit(response, {
    maxBytes: response.ok ? maxBytes : DEFAULT_MAX_ERROR_BODY_BYTES,
    label,
    signal,
  })
  signal?.throwIfAborted()
  return JSON.parse(text) as T
}

/** Partial attachment failures may be skipped, but cancellation and byte limits must stop the call. */
export function rethrowAttachmentDownloadError(error: unknown, signal?: AbortSignal): void {
  signal?.throwIfAborted()
  if (isPayloadSizeLimitError(error)) throw error
}
