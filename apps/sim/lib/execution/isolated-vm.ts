import { type ChildProcess, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
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
        try {
          worker?.send({ type: 'fetchResponse', fetchId, response })
        } catch (err) {
          logger.error('Failed to send fetch response to worker', { err, fetchId })
        }
      })
      .catch((err) => {
        try {
          worker?.send({
            type: 'fetchResponse',
            fetchId,
            response: JSON.stringify({
              error: err instanceof Error ? err.message : 'Fetch failed',
            }),
          })
        } catch (sendErr) {
          logger.error('Failed to send fetch error to worker', { sendErr, fetchId })
        }
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
    if (!checkNodeAvailable()) {
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
      reject(new Error(`Worker file not found at ${workerPath}`))
      return
    }

    import('node:child_process').then(({ spawn }) => {
      worker = spawn('node', [workerPath], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'json',
      })

      worker.on('message', handleWorkerMessage)

      let stderrData = ''
      worker.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })

      const startTimeout = setTimeout(() => {
        worker?.kill()
        worker = null
        workerReady = false
        workerReadyPromise = null
        reject(new Error('Worker failed to start within timeout'))
      }, 10000)

      const readyHandler = (message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'ready'
        ) {
          workerReady = true
          clearTimeout(startTimeout)
          worker?.off('message', readyHandler)
          resolve()
        }
      }
      worker.on('message', readyHandler)

      worker.on('exit', (code) => {
        if (workerIdleTimeout) {
          clearTimeout(workerIdleTimeout)
          workerIdleTimeout = null
        }

        const wasStartupFailure = !workerReady && workerReadyPromise

        worker = null
        workerReady = false
        workerReadyPromise = null

        let errorMessage = 'Worker process exited unexpectedly'
        if (stderrData.includes('isolated_vm') || stderrData.includes('MODULE_NOT_FOUND')) {
          errorMessage =
            'Code execution requires the isolated-vm native module which failed to load. ' +
            'This usually means the module needs to be rebuilt for your Node.js version. ' +
            'Please run: cd node_modules/isolated-vm && npm rebuild'
          logger.error('isolated-vm module failed to load', { stderr: stderrData })
        } else if (stderrData) {
          errorMessage = `Worker process failed: ${stderrData.slice(0, 500)}`
          logger.error('Worker process failed', { stderr: stderrData })
        }

        if (wasStartupFailure) {
          clearTimeout(startTimeout)
          reject(new Error(errorMessage))
          return
        }

        for (const [id, pending] of pendingExecutions) {
          clearTimeout(pending.timeout)
          pending.resolve({
            result: null,
            stdout: '',
            error: { message: errorMessage, name: 'WorkerError' },
          })
          pendingExecutions.delete(id)
        }
      })
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
