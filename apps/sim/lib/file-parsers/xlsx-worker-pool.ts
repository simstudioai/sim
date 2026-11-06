import { existsSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'
import type { FileParseOptions, FileParseResult } from '@/lib/file-parsers/types'
import {
  deserializeXlsxWorkerError,
  type XlsxWorkerMessage,
  type XlsxWorkerParseRequest,
} from '@/lib/file-parsers/xlsx-worker-protocol'

const logger = createLogger('XlsxWorkerPool')

/**
 * One worker: SheetJS parsing is synchronous, so in-process parses already run
 * one at a time and a single worker keeps peak workbook memory where it is today
 * while taking the parse off the event loop. Bun ignores `resourceLimits`, so a
 * worker's heap counts against the whole process exactly as an in-process parse
 * does; the bound here is concurrency, not heap size.
 */
const XLSX_WORKER_POOL_SIZE = 1

/** Releases an idle worker's heap (the last workbook's garbage) after a quiet period. */
const XLSX_WORKER_IDLE_TIMEOUT_MS = 30_000

/** Bounds worker startup only; a parse itself is bounded by the caller's signal. */
const XLSX_WORKER_START_TIMEOUT_MS = 10_000

const WORKER_BUNDLE_RELATIVE_PATH = path.join('dist', 'xlsx-worker.mjs')

/**
 * Where `bun run build:xlsx-worker` writes the bundle, as seen from the two
 * working directories the app runs in: the repo root (the Docker image runs
 * `bun apps/sim/bootstrap.js` from `/app`) and `apps/sim` (`next start`, tests).
 * Next bundles this module into server chunks, so `import.meta.url` does not
 * point at the source tree.
 */
export function resolveXlsxWorkerPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'apps', 'sim', WORKER_BUNDLE_RELATIVE_PATH),
    path.join(process.cwd(), WORKER_BUNDLE_RELATIVE_PATH),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

interface XlsxWorkerPoolConfig {
  /** Bundle to spawn; `null` parses every job in-process. */
  workerPath: string | null
  size: number
  idleTimeoutMs?: number
  startTimeoutMs?: number
}

type InProcessParse = () => Promise<FileParseResult>

interface Job {
  buffer: Buffer
  options: FileParseOptions
  fallback: InProcessParse
  resolve: (result: FileParseResult) => void
  reject: (error: unknown) => void
  detachAbort: () => void
}

interface Slot {
  worker: Worker
  ready: boolean
  job: Job | null
  idleTimer: ReturnType<typeof setTimeout> | null
  startTimer: ReturnType<typeof setTimeout> | null
}

/**
 * A bounded pool of spreadsheet parse workers with an in-process safety net.
 *
 * Any worker failure that is not a caller abort — a bundle that fails to load,
 * a startup that never reports ready, a crash mid-parse — disables the pool for
 * the life of the process (logged once) and runs the affected and queued jobs
 * through the caller's in-process parse, so a packaging mistake degrades to
 * exactly the pre-worker behavior instead of failing parses.
 *
 * Each dispatch copies the caller's bytes into a fresh `ArrayBuffer` and
 * transfers that copy: the caller's `Buffer` may be a pooled slab or still in
 * use (and is what the fallback parses), so it is never detached. Queued jobs
 * hold only the caller's reference, so waiting adds no memory.
 */
export class XlsxWorkerPool {
  private readonly queue: Job[] = []
  private readonly slots = new Set<Slot>()
  private disabled: boolean

  constructor(private readonly config: XlsxWorkerPoolConfig) {
    this.disabled = config.workerPath === null
  }

  async parse(
    buffer: Buffer,
    options: FileParseOptions,
    fallback: InProcessParse
  ): Promise<FileParseResult> {
    if (this.disabled) return fallback()
    const { signal } = options
    signal?.throwIfAborted()

    return new Promise<FileParseResult>((resolve, reject) => {
      const job: Job = { buffer, options, fallback, resolve, reject, detachAbort: () => {} }
      if (signal) {
        const onAbort = () => this.abort(job, signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        job.detachAbort = () => signal.removeEventListener('abort', onAbort)
      }
      this.queue.push(job)
      this.pump()
    })
  }

  private pump(): void {
    while (this.queue.length > 0) {
      if (this.disabled) {
        for (const job of this.queue.splice(0)) this.runInProcess(job)
        return
      }
      const slot = this.idleSlot() ?? this.spawn()
      if (!slot) return
      const job = this.queue.shift()
      if (!job) return
      slot.job = job
      if (slot.ready) this.dispatch(slot)
    }
  }

  private idleSlot(): Slot | null {
    for (const slot of this.slots) if (!slot.job) return slot
    return null
  }

  private spawn(): Slot | null {
    const { workerPath } = this.config
    if (!workerPath || this.slots.size >= this.config.size) return null

    let worker: Worker
    try {
      worker = new Worker(workerPath)
    } catch (error) {
      this.disable('XLSX parse worker failed to start; parsing in-process', error)
      return null
    }

    const slot: Slot = { worker, ready: false, job: null, idleTimer: null, startTimer: null }
    this.slots.add(slot)
    slot.startTimer = setTimeout(() => {
      this.fail(slot, new Error('worker did not report ready'))
    }, this.config.startTimeoutMs ?? XLSX_WORKER_START_TIMEOUT_MS)

    worker.on('message', (message: XlsxWorkerMessage) => this.onMessage(slot, message))
    worker.on('error', (error) => this.fail(slot, error))
    worker.on('exit', (code) => this.fail(slot, new Error(`worker exited with code ${code}`)))
    return slot
  }

  private onMessage(slot: Slot, message: XlsxWorkerMessage): void {
    if (message.type === 'ready') {
      slot.ready = true
      this.clearStartTimer(slot)
      if (slot.job) this.dispatch(slot)
      else this.markIdle(slot)
      return
    }

    const job = slot.job
    if (!job) return
    slot.job = null
    job.detachAbort()
    if (message.type === 'result') job.resolve(message.result)
    else job.reject(deserializeXlsxWorkerError(message.error))
    this.markIdle(slot)
    this.pump()
  }

  private dispatch(slot: Slot): void {
    const job = slot.job
    if (!job) return
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    slot.idleTimer = null
    slot.worker.ref()

    const data = new Uint8Array(job.buffer.byteLength)
    data.set(job.buffer)
    const request: XlsxWorkerParseRequest = {
      type: 'parse',
      data,
      options: omit(job.options, ['signal']),
    }
    try {
      slot.worker.postMessage(request, [data.buffer])
    } catch (error) {
      this.fail(slot, error)
    }
  }

  private markIdle(slot: Slot): void {
    slot.worker.unref()
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    slot.idleTimer = setTimeout(
      () => this.retire(slot),
      this.config.idleTimeoutMs ?? XLSX_WORKER_IDLE_TIMEOUT_MS
    )
    slot.idleTimer.unref?.()
  }

  private abort(job: Job, reason: unknown): void {
    job.detachAbort()
    const queuedIndex = this.queue.indexOf(job)
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1)
      job.reject(reason)
      return
    }
    for (const slot of this.slots) {
      if (slot.job !== job) continue
      slot.job = null
      this.retire(slot)
      job.reject(reason)
      this.pump()
      return
    }
  }

  /** Removes a slot this pool chose to stop; its exit event is then ignored. */
  private retire(slot: Slot): void {
    if (!this.slots.delete(slot)) return
    this.clearStartTimer(slot)
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    void slot.worker.terminate().catch(() => {})
  }

  /** An unrequested worker failure: disable the pool and finish its jobs in-process. */
  private fail(slot: Slot, error: unknown): void {
    if (!this.slots.has(slot)) return
    const job = slot.job
    slot.job = null
    this.retire(slot)
    this.disable('XLSX parse worker failed; parsing in-process for this process', error)
    if (job) this.runInProcess(job)
    this.pump()
  }

  private disable(message: string, error: unknown): void {
    if (this.disabled) return
    this.disabled = true
    logger.warn(message, { error })
    for (const slot of [...this.slots]) {
      const job = slot.job
      slot.job = null
      this.retire(slot)
      if (job) this.runInProcess(job)
    }
    for (const job of this.queue.splice(0)) this.runInProcess(job)
  }

  private runInProcess(job: Job): void {
    job.detachAbort()
    job.fallback().then(job.resolve, job.reject)
  }

  private clearStartTimer(slot: Slot): void {
    if (slot.startTimer) clearTimeout(slot.startTimer)
    slot.startTimer = null
  }
}

let defaultPool: XlsxWorkerPool | undefined

function getDefaultPool(): XlsxWorkerPool {
  if (defaultPool) return defaultPool
  /**
   * Off outside the production app server: dev and tests parse the live source
   * rather than a possibly stale bundle, and Trigger.dev workers (Node, no
   * bundle shipped) keep today's in-process path without a warning per process.
   */
  const enabled = process.env.NODE_ENV === 'production' && !isInsideTriggerRun()
  const workerPath = enabled ? resolveXlsxWorkerPath() : null
  if (enabled && !workerPath) {
    logger.warn('XLSX parse worker bundle not found; parsing in-process')
  }
  defaultPool = new XlsxWorkerPool({ workerPath, size: XLSX_WORKER_POOL_SIZE })
  return defaultPool
}

/**
 * Parses a spreadsheet buffer on a worker thread so SheetJS's synchronous
 * `XLSX.read` never blocks the event loop, falling back to `inProcess` with
 * identical output whenever the worker is unavailable.
 */
export function parseXlsxBufferOffThread(
  buffer: Buffer,
  options: FileParseOptions,
  inProcess: InProcessParse
): Promise<FileParseResult> {
  return getDefaultPool().parse(buffer, options, inProcess)
}
