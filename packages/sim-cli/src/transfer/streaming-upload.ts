import { SimApiError } from '../http/client'

/** One forward-only file stream shared by a PUT or successive multipart requests. */
export class StreamingUpload {
  private position = 0
  private pending: Uint8Array = new Uint8Array(0)
  private closed = false
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly onAbort: () => void
  private readonly stopped = new AbortController()
  readonly signal: AbortSignal

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly size: number,
    signal?: AbortSignal
  ) {
    this.signal = signal ? AbortSignal.any([signal, this.stopped.signal]) : this.stopped.signal
    this.reader = stream.getReader()
    this.onAbort = () => {
      void this.reader.cancel(this.signal.reason).catch(() => {})
    }
    this.signal.addEventListener('abort', this.onAbort, { once: true })
    if (this.signal.aborted) this.onAbort()
  }

  slice(start: number, end: number): ReadableStream<Uint8Array> {
    this.signal.throwIfAborted()
    if (this.closed || start !== this.position || end <= start || end > this.size) {
      throw new SimApiError('Upload parts must consume the snapshot in order', 0)
    }
    return new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          try {
            this.signal.throwIfAborted()
            while (this.pending.byteLength === 0) {
              const next = await this.reader.read()
              this.signal.throwIfAborted()
              if (next.done) throw new SimApiError('Upload file ended before its declared size', 0)
              this.pending = next.value
            }
            const length = Math.min(this.pending.byteLength, end - this.position)
            controller.enqueue(this.pending.subarray(0, length))
            this.pending = this.pending.subarray(length)
            this.position += length
            if (this.position === end) controller.close()
          } catch (error) {
            controller.error(error)
          }
        },
        cancel: (reason) => this.reader.cancel(reason),
      },
      { highWaterMark: 0 }
    )
  }

  assertConsumed(end: number): void {
    this.signal.throwIfAborted()
    if (this.position !== end) {
      throw new SimApiError('Upload was acknowledged before its complete body was consumed', 0)
    }
  }

  async verifyComplete(): Promise<void> {
    this.assertConsumed(this.size)
    if (this.pending.byteLength > 0) {
      throw new SimApiError('Upload file exceeds its declared size', 0)
    }
    while (true) {
      const next = await this.reader.read()
      this.signal.throwIfAborted()
      if (next.done) return
      if (next.value.byteLength > 0)
        throw new SimApiError('Upload file exceeds its declared size', 0)
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.stopped.abort()
    this.signal.removeEventListener('abort', this.onAbort)
    try {
      await this.reader.cancel().catch(() => {})
    } finally {
      this.reader.releaseLock()
    }
  }
}
