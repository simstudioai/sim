import { EventEmitter } from 'node:events'
import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'

const logger = createLogger('IsolatedVMRemoteWorker')

/** The host sends a heartbeat every 30s; 75s of silence is two missed beats plus slack. */
const HOST_SILENCE_LIMIT_MS = 75_000
const REMOTE_WORKER_URL_PATTERN = /^wss?:\/\/[^/]+\/v1\/worker$/
const MIN_REMOTE_WORKER_TOKEN_LENGTH = 32

/**
 * Thrown by a remote worker's `send` once its connection is closing: nothing was
 * delivered, so the message never reached the host.
 */
export class WorkerConnectionClosedError extends Error {
  constructor() {
    super('Remote isolated-vm worker connection is closed')
    this.name = 'WorkerConnectionClosedError'
  }
}

/**
 * The slice of `ChildProcess` the isolated-vm pool uses, so a local child and a
 * connection to a remote worker host are interchangeable.
 */
export interface IsolatedVMWorkerProcess {
  send(message: unknown): boolean
  kill(): boolean
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: () => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
  readonly stderr?: NodeJS.ReadableStream | null
  /** Why a remote worker closed, for the pool's startup-failure message. */
  readonly exitReason?: string
}

export interface RemoteWorkerOptions {
  url: string
  token: string
  /** Worker settings the app owns (limits, timezone, locale), so a remote worker matches a local one. */
  workerEnv: Record<string, string | undefined>
}

/**
 * Opens one worker on a remote isolated-vm host (`isolated-vm-host.cjs`).
 *
 * The first frame authenticates the connection; the host then spawns a
 * dedicated worker process for it and relays that worker's IPC messages as
 * JSON text frames, so the returned object emits the worker's own `ready`,
 * `result`, `fetch`, and `broker` messages. Closing the connection kills that
 * worker; any close, error, or silent host surfaces as `exit` exactly once,
 * which the pool treats like a crashed child.
 */
export function connectRemoteWorker(options: RemoteWorkerOptions): IsolatedVMWorkerProcess {
  if (!REMOTE_WORKER_URL_PATTERN.test(options.url)) {
    throw new Error('IVM_REMOTE_WORKER_URL must be a ws:// or wss:// URL ending in /v1/worker')
  }
  if (options.token.length < MIN_REMOTE_WORKER_TOKEN_LENGTH) {
    throw new Error(
      `IVM_REMOTE_WORKER_TOKEN must be at least ${MIN_REMOTE_WORKER_TOKEN_LENGTH} characters`
    )
  }

  const emitter = new EventEmitter()
  let exitReason: string | undefined
  let exited = false
  let silenceTimer: ReturnType<typeof setTimeout> | null = null

  const socket = new WebSocket(options.url)

  const emitExit = (reason: string) => {
    if (exited) return
    exited = true
    exitReason ??= reason
    if (silenceTimer) clearTimeout(silenceTimer)
    emitter.emit('exit')
  }

  /** Exits on a later tick, as a killed child does, so the pool never re-enters its own cleanup. */
  const terminate = (reason: string, closeCode?: number) => {
    exitReason ??= reason
    try {
      socket.close(closeCode)
    } catch {}
    setImmediate(() => emitExit(reason))
  }

  const resetSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = setTimeout(
      () => terminate('Remote isolated-vm host stopped responding'),
      HOST_SILENCE_LIMIT_MS
    )
  }

  socket.addEventListener('open', () => {
    resetSilenceTimer()
    socket.send(JSON.stringify({ type: 'auth', token: options.token, env: options.workerEnv }))
  })
  socket.addEventListener('message', (event) => {
    resetSilenceTimer()
    let message: unknown
    try {
      message = typeof event.data === 'string' ? JSON.parse(event.data) : undefined
    } catch {}
    if (!isRecordLike(message)) {
      logger.error('Remote isolated-vm host sent an invalid frame; closing the worker')
      terminate('Remote isolated-vm host sent an invalid frame')
      return
    }
    if (message.type === 'host:heartbeat') return
    emitter.emit('message', message)
  })
  socket.addEventListener('error', () => {
    exitReason ??= 'Remote isolated-vm host connection failed'
  })
  socket.addEventListener('close', (event) => {
    const detail = event.reason ? `: ${event.reason}` : ''
    if (event.code !== 1000) {
      logger.warn('Remote isolated-vm worker closed', { code: event.code, reason: event.reason })
    }
    emitExit(`Remote isolated-vm worker closed (code ${event.code}${detail})`)
  })

  return {
    /**
     * Throws {@link WorkerConnectionClosedError} once the connection is closing, so the pool can
     * tell a message that never left this process from one the host may have acted on.
     */
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) throw new WorkerConnectionClosedError()
      socket.send(JSON.stringify(message))
      return true
    },
    kill() {
      // A normal closure, so the pool retiring an idle or recycled worker isn't logged as a failure.
      terminate('Remote isolated-vm worker closed by the app', 1000)
      return true
    },
    on(event: 'message' | 'exit', listener: (message: unknown) => void) {
      emitter.on(event, listener)
      return this
    },
    off(event, listener) {
      emitter.off(event, listener)
      return this
    },
    stderr: null,
    get exitReason() {
      return exitReason
    },
  }
}
