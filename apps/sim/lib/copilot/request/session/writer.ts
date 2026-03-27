import { createLogger } from '@sim/logger'
import type { MothershipStreamV1EventEnvelope } from '@/lib/copilot/generated/mothership-stream-v1'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import { allocateCursor, appendEvent } from './buffer'
import { createEvent } from './event'
import { encodeSSEComment, encodeSSEEnvelope } from './sse'
import type { StreamEvent } from './types'

const logger = createLogger('StreamWriter')

const DEFAULT_KEEPALIVE_MS = 15_000

export interface StreamWriterOptions {
  streamId: string
  chatId?: string
  requestId: string
  keepaliveMs?: number
}

export class StreamWriter {
  private readonly streamId: string
  private readonly chatId: string | undefined
  private readonly requestId: string
  private readonly keepaliveMs: number
  private readonly encoder: TextEncoder
  private controller: ReadableStreamDefaultController | null = null
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null
  private _clientDisconnected = false
  private _sawComplete = false

  constructor(options: StreamWriterOptions) {
    this.streamId = options.streamId
    this.chatId = options.chatId
    this.requestId = options.requestId
    this.keepaliveMs = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS
    this.encoder = new TextEncoder()
  }

  get clientDisconnected(): boolean {
    return this._clientDisconnected
  }

  get sawComplete(): boolean {
    return this._sawComplete
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
          error: error instanceof Error ? error.message : String(error),
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

  async publish(event: StreamEvent): Promise<void> {
    const { seq, cursor } = await allocateCursor(this.streamId)
    const envelope = createEvent({
      streamId: this.streamId,
      chatId: this.chatId,
      cursor,
      seq,
      requestId: this.requestId,
      type: event.type,
      payload: event.payload,
      scope: event.scope,
    })
    await appendEvent(envelope)
    this.enqueue(envelope)
    if (event.type === MothershipStreamV1EventType.complete) {
      this._sawComplete = true
    }
  }

  markDisconnected(): void {
    this._clientDisconnected = true
  }

  close(): void {
    this.stopKeepalive()
    if (!this.controller) return
    try {
      this.controller.close()
    } catch {
      // Controller already closed
    }
    this.controller = null
  }

  private enqueue(envelope: MothershipStreamV1EventEnvelope): void {
    if (this._clientDisconnected || !this.controller) return
    try {
      this.controller.enqueue(encodeSSEEnvelope(envelope))
    } catch (error) {
      this._clientDisconnected = true
      logger.warn('Envelope enqueue failed, marking client disconnected', {
        streamId: this.streamId,
        requestId: this.requestId,
        seq: envelope.seq,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
