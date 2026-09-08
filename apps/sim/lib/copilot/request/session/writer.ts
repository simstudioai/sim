import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import { encodeSSEComment } from '@/lib/core/utils/sse'
import { appendEvents } from './buffer'
import type { PersistedStreamEventEnvelope } from './contract'
import { createEvent } from './event'
import { encodeSSEEnvelope } from './sse'
import type { StreamEvent } from './types'

const logger = createLogger('StreamWriter')

const DEFAULT_KEEPALIVE_MS = 15_000
const DEFAULT_PERSIST_FLUSH_INTERVAL_MS = 15
const DEFAULT_PERSIST_FLUSH_MAX_BATCH = 200

export interface StreamWriterOptions {
  streamId: string
  chatId?: string
  requestId: string
  /** Charges this stream's replay buffer to the user's cross-stream byte ceiling. */
  userId?: string
  keepaliveMs?: number
}

/** Result used when the soft stop is already latched, so no further append is attempted. */
const PERSISTENCE_ALREADY_STOPPED = { persisted: true } as const

export class StreamWriter {
  private readonly streamId: string
  private readonly chatId: string | undefined
  private readonly userId: string | undefined
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
  private _persistenceStopped = false
  private nextSeq = 0
  private pendingEnvelopes: PersistedStreamEventEnvelope[] = []
  private persistenceTail: Promise<void> = Promise.resolve()
  private lastPersistenceError: Error | null = null

  constructor(options: StreamWriterOptions) {
    this.streamId = options.streamId
    this.chatId = options.chatId
    this.userId = options.userId
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

  /**
   * The replay buffer stopped accepting writes because this stream exhausted its byte
   * budget. Live delivery is unaffected; only a resume would come back short.
   */
  get persistenceStopped(): boolean {
    return this._persistenceStopped
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
    // Once the budget has refused, every later batch would be refused too; stop
    // paying for the round trip.
    if (this._persistenceStopped) return
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
      .then(() =>
        /*
          Re-checked here, not only at enqueue: a batch queued while an earlier append was
          in flight would otherwise land after that append had already stopped persistence,
          leaving a replay that holds later events but not the refused ones — a hole a
          resuming client cannot detect.
        */
        this._persistenceStopped
          ? PERSISTENCE_ALREADY_STOPPED
          : appendEvents(batch, {
              streamId: this.streamId,
              ...(this.userId ? { userId: this.userId } : {}),
            })
      )
      .then((result) => {
        this.lastPersistenceError = null
        if (!result.persisted) {
          /*
            A budget refusal is deliberate, not a fault: it is left out of
            `lastPersistenceError` so `flush()` does not rethrow it. That throw would
            reach `finalizeStream`'s error-path flush and reject the response stream,
            ending a turn whose bytes the user already has. Stop persisting instead —
            a resume comes back short, which the caller can see.
          */
          this._persistenceStopped = true
          logger.warn('Stream replay buffer stopped: byte budget exhausted', {
            streamId: this.streamId,
            requestId: this.requestId,
            resource: result.refusal.resource,
            attemptedBytes: result.refusal.attemptedBytes,
            currentBytes: result.refusal.currentBytes,
            limitBytes: result.refusal.limitBytes,
          })
        }
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
