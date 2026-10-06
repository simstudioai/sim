/**
 * The inbox doorbell: a long-lived SSE stream on which Sim hints that this device's inbox
 * changed. Hints only; the inbox read they trigger is the record, and the executor also reads
 * it on a timer, so a lost event costs latency, never correctness. The stream reconnects with
 * backoff, opens its replacement when Sim announces a rotation, and is replaced when it goes
 * silent past the server's heartbeat.
 */
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { type DesktopExecutorClient, DeviceRequestError } from '@/main/desktop-executor/client'

const logger = createLogger('DesktopExecutorDoorbell')

/** Sim heartbeats every 30 s; two missed ones mean the connection is gone. */
const STALE_STREAM_MS = 75_000
const RECONNECT_MAX_MS = 30_000
/** A stream that stayed open this long was healthy; its clean end starts backoff afresh. */
const HEALTHY_STREAM_MS = 60_000
const HANDSHAKE_TIMEOUT_MS = 15_000

interface DoorbellOptions {
  client: Pick<DesktopExecutorClient, 'openInboxStream'>
  /** The inbox may have changed: on every event, and on every (re)connect. */
  onRing: () => void
  onUnregistered: () => void
  staleAfterMs?: number
  retryBaseMs?: number
}

interface ServerSentEvent {
  event: string
  data: string
}

/** Parses complete SSE blocks out of `buffer`, returning them and the unparsed remainder. */
export function parseServerSentEvents(buffer: string): {
  events: ServerSentEvent[]
  rest: string
} {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''
  const events: ServerSentEvent[] = []
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (data.length > 0 || event !== 'message') events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

export class InboxDoorbell {
  private running = false
  /** Which loop is current; a loop left over from before a stop ends at its next turn. */
  private loopGeneration = 0
  /** The connection was dropped on purpose; open the next one without backing off. */
  private reconnectNow = false
  private connection: AbortController | null = null
  private sleeper: AbortController | null = null

  constructor(private readonly options: DoorbellOptions) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.loopGeneration += 1
    void this.loop(this.loopGeneration)
  }

  stop(): void {
    this.running = false
    this.loopGeneration += 1
    this.connection?.abort()
    this.sleeper?.abort()
  }

  /**
   * After waking or coming back online: a stopped doorbell starts, and a running one drops its
   * connection, which may be dead without knowing it, and reconnects at once.
   */
  wake(): void {
    if (!this.running) {
      this.start()
      return
    }
    this.reconnectNow = true
    this.connection?.abort()
    this.sleeper?.abort()
  }

  private async loop(generation: number): Promise<void> {
    let attempt = 0
    const current = () => this.loopGeneration === generation
    while (current()) {
      const openedAt = Date.now()
      const rotated = await this.connectOnce().then(
        (result) => {
          if (result === 'rotated') {
            attempt = 0
            return true
          }
          // A stream something keeps closing right away is a failing connection, not a healthy one.
          attempt = Date.now() - openedAt >= HEALTHY_STREAM_MS ? 0 : attempt + 1
          return false
        },
        (error: unknown) => {
          if (this.reconnectNow) {
            this.reconnectNow = false
            attempt = 0
            return true
          }
          attempt += 1
          if (error instanceof DeviceRequestError && error.unregistered) {
            this.options.onUnregistered()
          }
          logger.info('Doorbell disconnected', {
            attempt,
            error: getErrorMessage(error),
          })
          return false
        }
      )
      if (!current() || rotated) continue
      this.sleeper = new AbortController()
      await interruptibleSleep(
        attempt === 0
          ? (this.options.retryBaseMs ?? 1_000)
          : backoffWithJitter(attempt, null, {
              baseMs: this.options.retryBaseMs ?? 1_000,
              maxMs: RECONNECT_MAX_MS,
            }),
        this.sleeper.signal
      )
      this.sleeper = null
    }
  }

  /** Holds one connection open; resolves when it ends cleanly or Sim asks for a rotation. */
  private async connectOnce(): Promise<'ended' | 'rotated'> {
    const connection = new AbortController()
    this.connection = connection
    const staleAfterMs = this.options.staleAfterMs ?? STALE_STREAM_MS
    let staleTimer: ReturnType<typeof setTimeout> | null = null
    const touch = () => {
      if (staleTimer) clearTimeout(staleTimer)
      staleTimer = setTimeout(() => connection.abort(), staleAfterMs)
    }
    try {
      // A stream whose response never starts is as dead as one that went quiet.
      const handshake = setTimeout(() => connection.abort(), HANDSHAKE_TIMEOUT_MS)
      const stream = await this.options.client
        .openInboxStream(connection.signal)
        .finally(() => clearTimeout(handshake))
      touch()
      this.options.onRing()
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return 'ended'
        touch()
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseServerSentEvents(buffer)
        buffer = parsed.rest
        for (const event of parsed.events) {
          if (event.event === 'rotate') {
            void reader.cancel().catch(() => {})
            return 'rotated'
          }
          if (event.event === 'inbox_changed') this.options.onRing()
        }
      }
    } finally {
      if (staleTimer) clearTimeout(staleTimer)
      connection.abort()
      if (this.connection === connection) this.connection = null
    }
  }
}
