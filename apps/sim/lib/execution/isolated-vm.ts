import { type ChildProcess, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { validateProxyUrl } from '@/lib/core/security/input-validation'

const logger = createLogger('IsolatedVMExecution')

let nodeAvailable: boolean | null = null

function checkNodeAvailable(): boolean {
  if (nodeAvailable !== null) return nodeAvailable
  try {
    execSync('node --version', { stdio: 'ignore' })
    nodeAvailable = true
  } catch {
    nodeAvailable = false
  }
  return nodeAvailable
}

export interface IsolatedVMExecutionRequest {
  code: string
  params: Record<string, unknown>
  envVars: Record<string, string>
  contextVariables: Record<string, unknown>
  timeoutMs: number
  requestId: string
}

export interface IsolatedVMExecutionResult {
  result: unknown
  stdout: string
  error?: IsolatedVMError
}

export interface IsolatedVMError {
  message: string
  name: string
  stack?: string
  line?: number
  column?: number
  lineContent?: string
}

const POOL_SIZE = Number.parseInt(env.IVM_POOL_SIZE) || 4
const MAX_CONCURRENT = Number.parseInt(env.IVM_MAX_CONCURRENT) || 10000
const MAX_PER_WORKER = Number.parseInt(env.IVM_MAX_PER_WORKER) || 2500
const WORKER_IDLE_TIMEOUT_MS = Number.parseInt(env.IVM_WORKER_IDLE_TIMEOUT_MS) || 60000
const QUEUE_TIMEOUT_MS = Number.parseInt(env.IVM_QUEUE_TIMEOUT_MS) || 300000

interface PendingExecution {
  resolve: (result: IsolatedVMExecutionResult) => void
  timeout: ReturnType<typeof setTimeout>
}

interface WorkerInfo {
  process: ChildProcess
  ready: boolean
  readyPromise: Promise<void> | null
  activeExecutions: number
  pendingExecutions: Map<number, PendingExecution>
  idleTimeout: ReturnType<typeof setTimeout> | null
  id: number
}

interface QueuedExecution {
  req: IsolatedVMExecutionRequest
  resolve: (result: IsolatedVMExecutionResult) => void
  queueTimeout: ReturnType<typeof setTimeout>
}

const workers: Map<number, WorkerInfo> = new Map()
const executionQueue: QueuedExecution[] = []
let totalActiveExecutions = 0
let executionIdCounter = 0
let nextWorkerId = 0
let spawnInProgress = 0

async function secureFetch(requestId: string, url: string, options?: RequestInit): Promise<string> {
  const validation = validateProxyUrl(url)
  if (!validation.isValid) {
    logger.warn(`[${requestId}] Blocked fetch request due to SSRF validation`, {
      url: url.substring(0, 100),
      error: validation.error,
    })
    return JSON.stringify({ error: `Security Error: ${validation.error}` })
  }

  try {
    const response = await fetch(url, options)
    const body = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
      headers,
    })
  } catch (error: unknown) {
    return JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown fetch error' })
  }
}

function handleWorkerMessage(workerId: number, message: unknown) {
  if (typeof message !== 'object' || message === null) return
  const msg = message as Record<string, unknown>
  const workerInfo = workers.get(workerId)

  if (msg.type === 'result') {
    const execId = msg.executionId as number
    const pending = workerInfo?.pendingExecutions.get(execId)
    if (pending) {
      clearTimeout(pending.timeout)
      workerInfo!.pendingExecutions.delete(execId)
      workerInfo!.activeExecutions--
      totalActiveExecutions--
      pending.resolve(msg.result as IsolatedVMExecutionResult)
      resetWorkerIdleTimeout(workerId)
      drainQueue()
    }
    return
  }

  if (msg.type === 'fetch') {
    const { fetchId, requestId, url, optionsJson } = msg as {
      fetchId: number
      requestId: string
      url: string
      optionsJson?: string
    }
    let options: RequestInit | undefined
    if (optionsJson) {
      try {
        options = JSON.parse(optionsJson)
      } catch {
        workerInfo?.process.send({
          type: 'fetchResponse',
          fetchId,
          response: JSON.stringify({ error: 'Invalid fetch options JSON' }),
        })
        return
      }
    }
    secureFetch(requestId, url, options)
      .then((response) => {
        try {
          workerInfo?.process.send({ type: 'fetchResponse', fetchId, response })
        } catch (err) {
          logger.error('Failed to send fetch response to worker', { err, fetchId, workerId })
        }
      })
      .catch((err) => {
        try {
          workerInfo?.process.send({
            type: 'fetchResponse',
            fetchId,
            response: JSON.stringify({
              error: err instanceof Error ? err.message : 'Fetch failed',
            }),
          })
        } catch (sendErr) {
          logger.error('Failed to send fetch error to worker', { sendErr, fetchId, workerId })
        }
      })
  }
}

function cleanupWorker(workerId: number) {
  const workerInfo = workers.get(workerId)
  if (!workerInfo) return

  if (workerInfo.idleTimeout) {
    clearTimeout(workerInfo.idleTimeout)
  }

  workerInfo.process.kill()

  for (const [id, pending] of workerInfo.pendingExecutions) {
    clearTimeout(pending.timeout)
    totalActiveExecutions--
    pending.resolve({
      result: null,
      stdout: '',
      error: { message: 'Worker process exited unexpectedly', name: 'WorkerError' },
    })
    workerInfo.pendingExecutions.delete(id)
  }

  workers.delete(workerId)
  logger.info('Worker removed from pool', { workerId, poolSize: workers.size })
}

function resetWorkerIdleTimeout(workerId: number) {
  const workerInfo = workers.get(workerId)
  if (!workerInfo) return

  if (workerInfo.idleTimeout) {
    clearTimeout(workerInfo.idleTimeout)
    workerInfo.idleTimeout = null
  }

  if (workerInfo.activeExecutions === 0) {
    workerInfo.idleTimeout = setTimeout(() => {
      const w = workers.get(workerId)
      if (w && w.activeExecutions === 0) {
        logger.info('Cleaning up idle worker', { workerId })
        cleanupWorker(workerId)
      }
    }, WORKER_IDLE_TIMEOUT_MS)
  }
}

function spawnWorker(): Promise<WorkerInfo> {
  const workerId = nextWorkerId++
  spawnInProgress++

  const workerInfo: WorkerInfo = {
    process: null as unknown as ChildProcess,
    ready: false,
    readyPromise: null,
    activeExecutions: 0,
    pendingExecutions: new Map(),
    idleTimeout: null,
    id: workerId,
  }

  workerInfo.readyPromise = new Promise<void>((resolve, reject) => {
    if (!checkNodeAvailable()) {
      spawnInProgress--
      reject(
        new Error(
          'Node.js is required for code execution but was not found. ' +
            'Please install Node.js (v20+) from https://nodejs.org'
        )
      )
      return
    }

    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const workerPath = path.join(currentDir, 'isolated-vm-worker.cjs')

    if (!fs.existsSync(workerPath)) {
      spawnInProgress--
      reject(new Error(`Worker file not found at ${workerPath}`))
      return
    }

    import('node:child_process').then(({ spawn }) => {
      const proc = spawn('node', [workerPath], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'json',
      })
      workerInfo.process = proc

      proc.on('message', (message: unknown) => handleWorkerMessage(workerId, message))

      let stderrData = ''
      proc.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })

      const startTimeout = setTimeout(() => {
        proc.kill()
        spawnInProgress--
        workers.delete(workerId)
        reject(new Error('Worker failed to start within timeout'))
      }, 10000)

      const readyHandler = (message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'ready'
        ) {
          workerInfo.ready = true
          spawnInProgress--
          clearTimeout(startTimeout)
          proc.off('message', readyHandler)
          workers.set(workerId, workerInfo)
          resetWorkerIdleTimeout(workerId)
          logger.info('Worker spawned and ready', { workerId, poolSize: workers.size })
          resolve()
        }
      }
      proc.on('message', readyHandler)

      proc.on('exit', () => {
        const wasStartupFailure = !workerInfo.ready

        if (wasStartupFailure) {
          spawnInProgress--
          clearTimeout(startTimeout)

          let errorMessage = 'Worker process exited unexpectedly'
          if (stderrData.includes('isolated_vm') || stderrData.includes('MODULE_NOT_FOUND')) {
            errorMessage =
              'Code execution requires the isolated-vm native module which failed to load. ' +
              'This usually means the module needs to be rebuilt for your Node.js version. ' +
              'Please run: cd node_modules/isolated-vm && npm rebuild'
            logger.error('isolated-vm module failed to load', { stderr: stderrData, workerId })
          } else if (stderrData) {
            errorMessage = `Worker process failed: ${stderrData.slice(0, 500)}`
            logger.error('Worker process failed', { stderr: stderrData, workerId })
          }

          reject(new Error(errorMessage))
          return
        }

        cleanupWorker(workerId)
        drainQueue()
      })
    })
  })

  return workerInfo.readyPromise.then(() => workerInfo)
}

/**
 * Returns the ready worker with the fewest active executions that still
 * has capacity, or null if none available.
 */
function selectWorker(): WorkerInfo | null {
  let best: WorkerInfo | null = null
  for (const w of workers.values()) {
    if (!w.ready) continue
    if (w.activeExecutions >= MAX_PER_WORKER) continue
    if (!best || w.activeExecutions < best.activeExecutions) {
      best = w
    }
  }
  return best
}

/**
 * Tries to get an existing worker with capacity, or spawns a new one if the
 * pool is not full. Returns null when the pool is at capacity and all workers
 * are saturated (caller should enqueue).
 */
async function acquireWorker(): Promise<WorkerInfo | null> {
  const existing = selectWorker()
  if (existing) return existing

  const currentPoolSize = workers.size + spawnInProgress
  if (currentPoolSize < POOL_SIZE) {
    try {
      return await spawnWorker()
    } catch (error) {
      logger.error('Failed to spawn worker', { error })
      return null
    }
  }

  return null
}

function dispatchToWorker(
  workerInfo: WorkerInfo,
  req: IsolatedVMExecutionRequest,
  resolve: (result: IsolatedVMExecutionResult) => void
) {
  const execId = ++executionIdCounter

  if (workerInfo.idleTimeout) {
    clearTimeout(workerInfo.idleTimeout)
    workerInfo.idleTimeout = null
  }

  const timeout = setTimeout(() => {
    workerInfo.pendingExecutions.delete(execId)
    workerInfo.activeExecutions--
    totalActiveExecutions--
    resolve({
      result: null,
      stdout: '',
      error: { message: `Execution timed out after ${req.timeoutMs}ms`, name: 'TimeoutError' },
    })
    resetWorkerIdleTimeout(workerInfo.id)
    drainQueue()
  }, req.timeoutMs + 1000)

  workerInfo.pendingExecutions.set(execId, { resolve, timeout })
  workerInfo.activeExecutions++
  totalActiveExecutions++

  try {
    workerInfo.process.send({ type: 'execute', executionId: execId, request: req })
  } catch {
    clearTimeout(timeout)
    workerInfo.pendingExecutions.delete(execId)
    workerInfo.activeExecutions--
    totalActiveExecutions--
    resolve({
      result: null,
      stdout: '',
      error: { message: 'Failed to send execution request to worker', name: 'WorkerError' },
    })
    resetWorkerIdleTimeout(workerInfo.id)
    drainQueue()
  }
}

function enqueueExecution(
  req: IsolatedVMExecutionRequest,
  resolve: (result: IsolatedVMExecutionResult) => void
) {
  const queueTimeout = setTimeout(() => {
    const idx = executionQueue.findIndex((q) => q.resolve === resolve)
    if (idx !== -1) {
      executionQueue.splice(idx, 1)
      resolve({
        result: null,
        stdout: '',
        error: {
          message: `Execution queued too long (${QUEUE_TIMEOUT_MS}ms). All workers are busy.`,
          name: 'QueueTimeoutError',
        },
      })
    }
  }, QUEUE_TIMEOUT_MS)

  executionQueue.push({ req, resolve, queueTimeout })
  logger.info('Execution queued', {
    queueLength: executionQueue.length,
    totalActive: totalActiveExecutions,
    poolSize: workers.size,
  })
}

/**
 * Called after every completion or worker spawn — dispatches queued
 * executions to available workers.
 */
function drainQueue() {
  while (executionQueue.length > 0 && totalActiveExecutions < MAX_CONCURRENT) {
    const worker = selectWorker()
    if (!worker) {
      const currentPoolSize = workers.size + spawnInProgress
      if (currentPoolSize < POOL_SIZE) {
        spawnWorker()
          .then(() => drainQueue())
          .catch((err) => logger.error('Failed to spawn worker during drain', { err }))
      }
      break
    }

    const queued = executionQueue.shift()!
    clearTimeout(queued.queueTimeout)
    dispatchToWorker(worker, queued.req, queued.resolve)
  }
}

/**
 * Execute JavaScript code in an isolated V8 isolate via Node.js subprocess.
 */
export async function executeInIsolatedVM(
  req: IsolatedVMExecutionRequest
): Promise<IsolatedVMExecutionResult> {
  if (totalActiveExecutions >= MAX_CONCURRENT) {
    return new Promise((resolve) => enqueueExecution(req, resolve))
  }

  const workerInfo = await acquireWorker()
  if (!workerInfo) {
    return new Promise((resolve) => enqueueExecution(req, resolve))
  }

  return new Promise((resolve) => dispatchToWorker(workerInfo, req, resolve))
}
