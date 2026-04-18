import { createLogger } from '@sim/logger'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import { toError } from '@/lib/core/utils/helpers'
import { appendEvents } from './buffer'
import type { PersistedStreamEventEnvelope } from './contract'
import { createEvent } from './event'
import { encodeSSEComment, encodeSSEEnvelope } from './sse'
import type { StreamEvent } from './types'

const logger = createLogger('StreamWriter')

const DEFAULT_KEEPALIVE_MS = 15_000
const DEFAULT_PERSIST_FLUSH_INTERVAL_MS = 15
const DEFAULT_PERSIST_FLUSH_MAX_BATCH = 200

export interface StreamWriterOptions {
  streamId: string
  chatId?: string
  requestId: string
  keepaliveMs?: number
}

export class StreamWriter {
  private readonly streamId: string
  private readonly chatId: string | undefined
  private requestId: string
  private readonly keepaliveMs: number
  private readonly flushIntervalMs: number
  private readonly flushMaxBatch: number
  private readonly encoder: TextEncoder
  private controller: ReadableStreamDefaultController | null = null
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private _clientDisconnected = false
  private _sawComplete = false
  private nextSeq = 0
  private pendingEnvelopes: PersistedStreamEventEnvelope[] = []
  private persistenceTail: Promise<void> = Promise.resolve()
  private lastPersistenceError: Error | null = null

  constructor(options: StreamWriterOptions) {
    this.streamId = options.streamId
    this.chatId = options.chatId
    this.requestId = options.requestId
    this.keepaliveMs = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS
    this.flushIntervalMs = DEFAULT_PERSIST_FLUSH_INTERVAL_MS
    this.flushMaxBatch = DEFAULT_PERSIST_FLUSH_MAX_BATCH
    this.encoder = new TextEncoder()
  }

  get clientDisconnected(): boolean {
    return this._clientDisconnected
  }

  get sawComplete(): boolean {
    return this._sawComplete
  }

  updateRequestId(id: string): void {
    this.requestId = id
  }

  attach(controller: ReadableStreamDefaultController): void {
    this.controller = controller
  }

  startKeepalive(): void {
    this.keepaliveInterval = setInterval(() => {
      if (this._clientDisconnected || !this.controller) return
      try {
        this.controller.enqueue(encodeSSEComment('keepalive'))
      } catch (error) {
        this._clientDisconnected = true
        logger.warn('Keepalive enqueue failed, marking client disconnected', {
          streamId: this.streamId,
          requestId: this.requestId,
          error: toError(error).message,
        })
      }
    }, this.keepaliveMs)
  }

  stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
  }

  publish(event: StreamEvent): void {
    const envelope = this.createEnvelope(event)
    this.enqueue(envelope)
    this.queuePersistence(envelope)
    if (event.type === MothershipStreamV1EventType.complete) {
      this._sawComplete = true
    }
  }

  markDisconnected(): void {
    this._clientDisconnected = true
  }

  async flush(): Promise<void> {
    this.flushPendingPersistence()
    await this.persistenceTail
    if (this.lastPersistenceError) {
      const error = this.lastPersistenceError
      this.lastPersistenceError = null
      throw error
    }
  }

  async close(): Promise<void> {
    this.stopKeepalive()
    this.clearFlushTimer()
    await this.flush()
    if (!this.controller) return
    try {
      this.controller.close()
    } catch {
      // Controller already closed
    }
    this.controller = null
  }

  private enqueue(envelope: PersistedStreamEventEnvelope): void {
    if (this._clientDisconnected || !this.controller) return
    try {
      this.controller.enqueue(encodeSSEEnvelope(envelope))
    } catch (error) {
      this._clientDisconnected = true
      logger.warn('Envelope enqueue failed, marking client disconnected', {
        streamId: this.streamId,
        requestId: this.requestId,
        seq: envelope.seq,
        error: toError(error).message,
      })
    }
  }

  private createEnvelope(event: StreamEvent): PersistedStreamEventEnvelope {
    const seq = ++this.nextSeq
    return createEvent({
      ...event,
      streamId: this.streamId,
      chatId: this.chatId,
      cursor: String(seq),
      seq,
      requestId: this.requestId,
    })
  }

  private queuePersistence(envelope: PersistedStreamEventEnvelope): void {
    this.pendingEnvelopes.push(envelope)
    if (this.pendingEnvelopes.length >= this.flushMaxBatch) {
      this.flushPendingPersistence()
      return
    }
    if (this.flushTimer || this.pendingEnvelopes.length === 0) {
      return
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushPendingPersistence()
    }, this.flushIntervalMs)
  }

  private flushPendingPersistence(): void {
    this.clearFlushTimer()
    if (this.pendingEnvelopes.length === 0) {
      return
    }
    const batch = this.pendingEnvelopes
    this.pendingEnvelopes = []
    this.persistenceTail = this.persistenceTail
      .catch(() => undefined)
      .then(() => appendEvents(batch))
      .then(() => {
        this.lastPersistenceError = null
      })
      .catch((error) => {
        this.lastPersistenceError = toError(error)
        logger.warn('Failed to persist stream envelope batch', {
          streamId: this.streamId,
          requestId: this.requestId,
          batchSize: batch.length,
          firstSeq: batch[0]?.seq,
          lastSeq: batch[batch.length - 1]?.seq,
          error: toError(error).message,
        })
      })
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }
}
