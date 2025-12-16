import { type ChildProcess, fork } from 'node:child_process'
import { validateProxyUrl } from '@/lib/core/security/input-validation'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('IsolatedVMExecution')

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

interface PendingExecution {
  resolve: (result: IsolatedVMExecutionResult) => void
  timeout: ReturnType<typeof setTimeout>
}

let worker: ChildProcess | null = null
let workerReady = false
let workerReadyPromise: Promise<void> | null = null
let workerIdleTimeout: ReturnType<typeof setTimeout> | null = null
const pendingExecutions = new Map<number, PendingExecution>()
let executionIdCounter = 0

const WORKER_IDLE_TIMEOUT_MS = 60000

function cleanupWorker() {
  if (workerIdleTimeout) {
    clearTimeout(workerIdleTimeout)
    workerIdleTimeout = null
  }
  if (worker) {
    worker.kill()
    worker = null
  }
  workerReady = false
  workerReadyPromise = null
}

function resetIdleTimeout() {
  if (workerIdleTimeout) {
    clearTimeout(workerIdleTimeout)
  }
  workerIdleTimeout = setTimeout(() => {
    if (pendingExecutions.size === 0) {
      logger.info('Cleaning up idle isolated-vm worker')
      cleanupWorker()
    }
  }, WORKER_IDLE_TIMEOUT_MS)
}

/**
 * Secure fetch wrapper that validates URLs to prevent SSRF attacks
 */
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

/**
 * Handle IPC messages from the Node.js worker
 */
function handleWorkerMessage(message: unknown) {
  if (typeof message !== 'object' || message === null) return
  const msg = message as Record<string, unknown>

  if (msg.type === 'result') {
    const pending = pendingExecutions.get(msg.executionId as number)
    if (pending) {
      clearTimeout(pending.timeout)
      pendingExecutions.delete(msg.executionId as number)
      pending.resolve(msg.result as IsolatedVMExecutionResult)
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
        worker?.send({
          type: 'fetchResponse',
          fetchId,
          response: JSON.stringify({ error: 'Invalid fetch options JSON' }),
        })
        return
      }
    }
    secureFetch(requestId, url, options)
      .then((response) => {
        worker?.send({ type: 'fetchResponse', fetchId, response })
      })
      .catch((err) => {
        worker?.send({
          type: 'fetchResponse',
          fetchId,
          response: JSON.stringify({ error: err instanceof Error ? err.message : 'Fetch failed' }),
        })
      })
  }
}

/**
 * Start the Node.js worker process
 */
async function ensureWorker(): Promise<void> {
  if (workerReady && worker) return
  if (workerReadyPromise) return workerReadyPromise

  workerReadyPromise = new Promise<void>((resolve, reject) => {
    const workerPath = new URL('./isolated-vm-worker.cjs', import.meta.url).pathname

    worker = fork(workerPath, [], {
      stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
      serialization: 'json',
    })

    worker.on('message', handleWorkerMessage)

    const startTimeout = setTimeout(() => {
      worker?.kill()
      worker = null
      workerReady = false
      workerReadyPromise = null
      reject(new Error('Worker failed to start within timeout'))
    }, 10000)

    worker.once('message', (message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'ready'
      ) {
        workerReady = true
        clearTimeout(startTimeout)
        resolve()
      }
    })

    worker.on('exit', (code) => {
      logger.warn('Isolated-vm worker exited', { code })
      if (workerIdleTimeout) {
        clearTimeout(workerIdleTimeout)
        workerIdleTimeout = null
      }
      worker = null
      workerReady = false
      workerReadyPromise = null
      for (const [id, pending] of pendingExecutions) {
        clearTimeout(pending.timeout)
        pending.resolve({
          result: null,
          stdout: '',
          error: { message: 'Worker process exited unexpectedly', name: 'WorkerError' },
        })
        pendingExecutions.delete(id)
      }
    })
  })

  return workerReadyPromise
}

/**
 * Execute JavaScript code in an isolated V8 isolate via Node.js subprocess.
 * The worker's V8 isolate enforces timeoutMs internally. The parent timeout
 * (timeoutMs + 1000) is a safety buffer for IPC communication.
 */
export async function executeInIsolatedVM(
  req: IsolatedVMExecutionRequest
): Promise<IsolatedVMExecutionResult> {
  if (workerIdleTimeout) {
    clearTimeout(workerIdleTimeout)
    workerIdleTimeout = null
  }

  await ensureWorker()

  if (!worker) {
    return {
      result: null,
      stdout: '',
      error: { message: 'Failed to start isolated-vm worker', name: 'WorkerError' },
    }
  }

  const executionId = ++executionIdCounter

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingExecutions.delete(executionId)
      resolve({
        result: null,
        stdout: '',
        error: { message: `Execution timed out after ${req.timeoutMs}ms`, name: 'TimeoutError' },
      })
    }, req.timeoutMs + 1000)

    pendingExecutions.set(executionId, { resolve, timeout })

    try {
      worker!.send({ type: 'execute', executionId, request: req })
    } catch {
      clearTimeout(timeout)
      pendingExecutions.delete(executionId)
      resolve({
        result: null,
        stdout: '',
        error: { message: 'Failed to send execution request to worker', name: 'WorkerError' },
      })
      return
    }

    resetIdleTimeout()
  })
}
