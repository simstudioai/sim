import { existsSync } from 'node:fs'
import path from 'node:path'
import { createOracleConnectProxy } from '@/lib/internal/oracledb/connect-proxy'
import type { OracleConnectionInput } from '@/lib/internal/oracledb/schema'
import {
  ORACLE_MAX_WORKER_RESPONSE_BYTES,
  ORACLE_WORKER_PROTOCOL_VERSION,
  type OracleWorkerRequest,
  type OracleWorkerStatement,
  type OracleWorkerStatementResult,
  parseOracleWorkerResponse,
  serializeOracleWorkerRequest,
} from '@/lib/internal/oracledb/worker-protocol'

const WORKER_FORCE_KILL_GRACE_MS = 2_000
const MAX_OPERATION_TIMEOUT_MS = 5 * 60 * 1000
const MAX_CONCURRENT_WORKERS = 2
const MAX_PENDING_WORKERS = 4
const WORKER_QUEUE_WAIT_MS = 30_000

interface WorkerSlotWaiter {
  resolve: (release: () => void) => void
  reject: (reason?: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
  timeout?: NodeJS.Timeout
}

const ORACLE_WORKER_SEMAPHORE = Symbol.for('sim.oracledb.worker-semaphore')

interface OracleWorkerSemaphore {
  activeWorkers: number
  waiters: WorkerSlotWaiter[]
}

interface OracleWorkerCarrier {
  [ORACLE_WORKER_SEMAPHORE]?: OracleWorkerSemaphore
}

/**
 * Keeps the child-process limit shared by duplicate server bundles loaded into
 * one JavaScript process instead of accidentally enforcing it per module copy.
 */
function workerSemaphore(): OracleWorkerSemaphore {
  const carrier = globalThis as OracleWorkerCarrier
  carrier[ORACLE_WORKER_SEMAPHORE] ??= { activeWorkers: 0, waiters: [] }
  return carrier[ORACLE_WORKER_SEMAPHORE]
}

export class OracleWorkerError extends Error {}

function cleanupWorkerWaiter(waiter: WorkerSlotWaiter): void {
  waiter.signal?.removeEventListener('abort', waiter.onAbort!)
  if (waiter.timeout) clearTimeout(waiter.timeout)
  const waiters = workerSemaphore().waiters
  const index = waiters.indexOf(waiter)
  if (index !== -1) waiters.splice(index, 1)
}

function releaseWorkerSlot(): void {
  const semaphore = workerSemaphore()
  while (semaphore.waiters.length > 0) {
    const waiter = semaphore.waiters.shift()!
    cleanupWorkerWaiter(waiter)
    if (waiter.signal?.aborted) {
      waiter.reject(waiter.signal.reason)
      continue
    }
    waiter.resolve(createWorkerSlotRelease())
    return
  }
  semaphore.activeWorkers -= 1
}

function createWorkerSlotRelease(): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    releaseWorkerSlot()
  }
}

async function acquireWorkerSlot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted()
  const semaphore = workerSemaphore()
  if (semaphore.activeWorkers < MAX_CONCURRENT_WORKERS) {
    semaphore.activeWorkers += 1
    return createWorkerSlotRelease()
  }
  if (semaphore.waiters.length >= MAX_PENDING_WORKERS) {
    throw new OracleWorkerError('Oracle Database worker capacity is busy; try again later')
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: WorkerSlotWaiter = { resolve, reject, signal }
    const onAbort = () => {
      cleanupWorkerWaiter(waiter)
      reject(signal?.reason)
    }
    waiter.onAbort = onAbort
    waiter.timeout = setTimeout(() => {
      cleanupWorkerWaiter(waiter)
      reject(new OracleWorkerError('Oracle Database worker queue wait exceeded 30 seconds'))
    }, WORKER_QUEUE_WAIT_MS)
    waiter.timeout.unref()
    semaphore.waiters.push(waiter)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

function resolveOracleWorkerPath(): string {
  const candidates = [
    path.join(process.cwd(), 'lib/internal/oracledb/oracle-worker.cjs'),
    path.join(process.cwd(), 'apps/sim/lib/internal/oracledb/oracle-worker.cjs'),
  ]
  if (typeof __dirname === 'string') {
    candidates.push(path.join(__dirname, 'oracle-worker.cjs'))
  }
  const workerPath = candidates.find((candidate) => existsSync(candidate))
  if (!workerPath) {
    throw new OracleWorkerError('Oracle Database worker is not available in this deployment')
  }
  return workerPath
}

function operationTimeout(connectionTimeout: number, statementCount: number): number {
  return Math.min(
    MAX_OPERATION_TIMEOUT_MS,
    Math.max(30_000, connectionTimeout * (statementCount + 3))
  )
}

async function runWorkerProcess(
  request: OracleWorkerRequest,
  connectionTimeout: number,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const serialized = serializeOracleWorkerRequest(request)
  const { spawn } = await import('node:child_process')
  const child = spawn(
    /* turbopackIgnore: true */ 'node',
    ['--max-old-space-size=128', resolveOracleWorkerPath()],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: process.env.NODE_ENV,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  )

  const stdout: Buffer[] = []
  let stdoutBytes = 0
  let processError: Error | undefined
  let timedOut = false
  let forceKill: NodeJS.Timeout | undefined

  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null || forceKill) return
    child.kill('SIGTERM')
    forceKill = setTimeout(() => child.kill('SIGKILL'), WORKER_FORCE_KILL_GRACE_MS)
    forceKill.unref()
  }
  const timeout = setTimeout(
    () => {
      timedOut = true
      terminate()
    },
    operationTimeout(connectionTimeout, request.statements.length)
  )
  timeout.unref()

  const abort = () => {
    terminate()
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) terminate()

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length
    if (stdoutBytes > ORACLE_MAX_WORKER_RESPONSE_BYTES) {
      processError = new Error('Oracle worker response exceeded the 10 MiB response ceiling')
      child.kill('SIGKILL')
      return
    }
    stdout.push(chunk)
  })
  child.stderr.on('data', () => {})
  child.once('error', (error) => {
    processError = error
  })
  child.stdin.on('error', () => {})
  child.stdin.end(serialized)

  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }))
      }
    )
    signal?.throwIfAborted()
    if (timedOut) {
      throw new OracleWorkerError('Oracle Database operation exceeded its execution timeout')
    }
    if (processError) {
      throw new OracleWorkerError(`Oracle Database worker failed: ${processError.message}`)
    }

    const output = Buffer.concat(stdout, stdoutBytes).toString('utf8').trim()
    if (!output) {
      const suffix = exit.signal ? ` (${exit.signal})` : exit.code === null ? '' : ` (${exit.code})`
      throw new OracleWorkerError(`Oracle Database worker exited without a response${suffix}`)
    }

    try {
      return JSON.parse(output) as unknown
    } catch {
      throw new OracleWorkerError('Oracle Database worker returned malformed output')
    }
  } finally {
    clearTimeout(timeout)
    if (forceKill) clearTimeout(forceKill)
    signal?.removeEventListener('abort', abort)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

/** Runs one bounded request in the verified Node-oracledb worker. */
export async function executeOracleStatements(
  connection: OracleConnectionInput,
  statements: OracleWorkerStatement[],
  options: { readOnlyTransaction?: boolean } = {},
  signal?: AbortSignal
): Promise<OracleWorkerStatementResult[]> {
  signal?.throwIfAborted()
  const requestTimeout = operationTimeout(connection.connectionTimeout, statements.length)
  const deadline = new AbortController()
  const deadlineTimer = setTimeout(
    () =>
      deadline.abort(
        new OracleWorkerError('Oracle Database operation exceeded its execution timeout')
      ),
    requestTimeout
  )
  deadlineTimer.unref()
  const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal

  let releaseWorker: (() => void) | undefined
  let proxy: Awaited<ReturnType<typeof createOracleConnectProxy>> | undefined

  try {
    releaseWorker = await acquireWorkerSlot(requestSignal)
    proxy = await createOracleConnectProxy(connection.connectionTimeout, requestSignal)
    const responseValue = await runWorkerProcess(
      {
        protocolVersion: ORACLE_WORKER_PROTOCOL_VERSION,
        type: 'execute',
        connection: {
          ...connection,
          proxyHost: proxy.host,
          proxyPort: proxy.port,
        },
        statements,
        readOnlyTransaction: options.readOnlyTransaction === true,
      },
      connection.connectionTimeout,
      requestSignal
    )
    const response = parseOracleWorkerResponse(responseValue)
    if (!response.ok) {
      throw new OracleWorkerError(proxy.getFailureReason() ?? response.error.message)
    }
    if (response.results.length !== statements.length) {
      throw new OracleWorkerError('Oracle Database worker returned an incomplete result')
    }
    return response.results
  } finally {
    clearTimeout(deadlineTimer)
    try {
      await proxy?.close()
    } finally {
      releaseWorker?.()
    }
  }
}

export const oracleClientInternals = {
  MAX_CONCURRENT_WORKERS,
  MAX_PENDING_WORKERS,
  WORKER_QUEUE_WAIT_MS,
  acquireWorkerSlot,
  activeWorkers: () => workerSemaphore().activeWorkers,
  pendingWorkers: () => workerSemaphore().waiters.length,
  operationTimeout,
  resolveOracleWorkerPath,
}
