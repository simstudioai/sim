import { type ChildProcess, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'
import {
  type SecureFetchOptions,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'

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
  ownerKey?: string
  ownerWeight?: number
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
const MAX_QUEUE_SIZE = Number.parseInt(env.IVM_MAX_QUEUE_SIZE) || 10000
const MAX_FETCH_RESPONSE_BYTES = Number.parseInt(env.IVM_MAX_FETCH_RESPONSE_BYTES) || 8_388_608
const MAX_FETCH_RESPONSE_CHARS = Number.parseInt(env.IVM_MAX_FETCH_RESPONSE_CHARS) || 4_000_000
const MAX_FETCH_URL_LENGTH = Number.parseInt(env.IVM_MAX_FETCH_URL_LENGTH) || 8192
const MAX_FETCH_OPTIONS_JSON_CHARS =
  Number.parseInt(env.IVM_MAX_FETCH_OPTIONS_JSON_CHARS) || 262_144
const MAX_ACTIVE_PER_OWNER = Number.parseInt(env.IVM_MAX_ACTIVE_PER_OWNER) || 200
const MAX_QUEUED_PER_OWNER = Number.parseInt(env.IVM_MAX_QUEUED_PER_OWNER) || 2000
const MAX_OWNER_WEIGHT = Number.parseInt(env.IVM_MAX_OWNER_WEIGHT) || 5
const DISTRIBUTED_MAX_INFLIGHT_PER_OWNER =
  Number.parseInt(env.IVM_DISTRIBUTED_MAX_INFLIGHT_PER_OWNER) ||
  MAX_ACTIVE_PER_OWNER + MAX_QUEUED_PER_OWNER
const DISTRIBUTED_LEASE_MIN_TTL_MS = Number.parseInt(env.IVM_DISTRIBUTED_LEASE_MIN_TTL_MS) || 120000
const DISTRIBUTED_KEY_PREFIX = 'ivm:fair:v1:owner'
const QUEUE_RETRY_DELAY_MS = 1000
const DISTRIBUTED_LEASE_GRACE_MS = 30000

interface PendingExecution {
  resolve: (result: IsolatedVMExecutionResult) => void
  timeout: ReturnType<typeof setTimeout>
  ownerKey: string
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
  id: number
  ownerKey: string
  req: IsolatedVMExecutionRequest
  resolve: (result: IsolatedVMExecutionResult) => void
  queueTimeout: ReturnType<typeof setTimeout>
}

interface QueueNode {
  ownerKey: string
  value: QueuedExecution
  prev: QueueNode | null
  next: QueueNode | null
}

interface OwnerState {
  ownerKey: string
  weight: number
  activeExecutions: number
  queueHead: QueueNode | null
  queueTail: QueueNode | null
  queueLength: number
  burstRemaining: number
}

const workers: Map<number, WorkerInfo> = new Map()
const ownerStates: Map<string, OwnerState> = new Map()
const queuedOwnerRing: string[] = []
let queuedOwnerCursor = 0
let queueSize = 0
const queueNodes: Map<number, QueueNode> = new Map()
let totalActiveExecutions = 0
let executionIdCounter = 0
let queueIdCounter = 0
let nextWorkerId = 0
let spawnInProgress = 0
let queueDrainRetryTimeout: ReturnType<typeof setTimeout> | null = null

type IsolatedFetchOptions = RequestInit & {
  timeout?: number
  maxRedirects?: number
}

function truncateString(value: string, maxChars: number): { value: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { value, truncated: false }
  }
  return {
    value: `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`,
    truncated: true,
  }
}

function normalizeFetchOptions(options?: IsolatedFetchOptions): SecureFetchOptions {
  if (!options) return { maxResponseBytes: MAX_FETCH_RESPONSE_BYTES }

  const normalized: SecureFetchOptions = {
    maxResponseBytes: MAX_FETCH_RESPONSE_BYTES,
  }

  if (typeof options.method === 'string' && options.method.length > 0) {
    normalized.method = options.method
  }

  if (
    typeof options.timeout === 'number' &&
    Number.isFinite(options.timeout) &&
    options.timeout > 0
  ) {
    normalized.timeout = Math.floor(options.timeout)
  }

  if (
    typeof options.maxRedirects === 'number' &&
    Number.isFinite(options.maxRedirects) &&
    options.maxRedirects >= 0
  ) {
    normalized.maxRedirects = Math.floor(options.maxRedirects)
  }

  if (options.headers) {
    const headers: Record<string, string> = {}
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers[key] = value
      })
    } else if (Array.isArray(options.headers)) {
      for (const [key, value] of options.headers) {
        headers[String(key)] = String(value)
      }
    } else {
      for (const [key, value] of Object.entries(options.headers)) {
        headers[key] = String(value)
      }
    }
    normalized.headers = headers
  }

  if (
    typeof options.body === 'string' ||
    options.body instanceof Buffer ||
    options.body instanceof Uint8Array
  ) {
    normalized.body = options.body
  } else if (options.body !== undefined && options.body !== null) {
    normalized.body = String(options.body)
  }

  return normalized
}

async function secureFetch(
  requestId: string,
  url: string,
  options?: IsolatedFetchOptions
): Promise<string> {
  if (url.length > MAX_FETCH_URL_LENGTH) {
    return JSON.stringify({
      error: `Security Error: fetch URL exceeds maximum length (${MAX_FETCH_URL_LENGTH})`,
    })
  }

  try {
    const response = await secureFetchWithValidation(
      url,
      normalizeFetchOptions(options),
      'fetchUrl'
    )
    const bodyResult = truncateString(await response.text(), MAX_FETCH_RESPONSE_CHARS)
    const headers: Record<string, string> = {}
    for (const [key, value] of response.headers) {
      headers[key] = value
    }
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: bodyResult.value,
      bodyTruncated: bodyResult.truncated,
      headers,
    })
  } catch (error: unknown) {
    logger.warn(`[${requestId}] Isolated fetch failed`, {
      url: sanitizeUrlForLog(url),
      error: error instanceof Error ? error.message : String(error),
    })
    return JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown fetch error' })
  }
}

function normalizeOwnerKey(ownerKey?: string): string {
  if (!ownerKey) return 'anonymous'
  const normalized = ownerKey.trim()
  return normalized || 'anonymous'
}

function normalizeOwnerWeight(ownerWeight?: number): number {
  if (!Number.isFinite(ownerWeight) || ownerWeight === undefined) return 1
  return Math.max(1, Math.min(MAX_OWNER_WEIGHT, Math.floor(ownerWeight)))
}

function ownerRedisKey(ownerKey: string): string {
  return `${DISTRIBUTED_KEY_PREFIX}:${ownerKey}`
}

type LeaseAcquireResult = 'acquired' | 'limit_exceeded' | 'unavailable'

async function tryAcquireDistributedLease(
  ownerKey: string,
  leaseId: string,
  timeoutMs: number
): Promise<LeaseAcquireResult> {
  // Redis not configured: explicit local-mode fallback is allowed.
  if (!env.REDIS_URL) return 'acquired'

  const redis = getRedisClient()
  if (!redis) {
    logger.error('Redis is configured but unavailable for distributed lease acquisition', {
      ownerKey,
    })
    return 'unavailable'
  }

  const now = Date.now()
  const leaseTtlMs = Math.max(
    timeoutMs + QUEUE_TIMEOUT_MS + DISTRIBUTED_LEASE_GRACE_MS,
    DISTRIBUTED_LEASE_MIN_TTL_MS
  )
  const expiresAt = now + leaseTtlMs
  const key = ownerRedisKey(ownerKey)

  const script = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
    local current = redis.call('ZCARD', KEYS[1])
    if current >= tonumber(ARGV[2]) then
      return 0
    end
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
    redis.call('PEXPIRE', KEYS[1], ARGV[5])
    return 1
  `

  try {
    const result = await redis.eval(
      script,
      1,
      key,
      now.toString(),
      DISTRIBUTED_MAX_INFLIGHT_PER_OWNER.toString(),
      expiresAt.toString(),
      leaseId,
      leaseTtlMs.toString()
    )
    return Number(result) === 1 ? 'acquired' : 'limit_exceeded'
  } catch (error) {
    logger.error('Failed to acquire distributed owner lease', { ownerKey, error })
    return 'unavailable'
  }
}

async function releaseDistributedLease(ownerKey: string, leaseId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const key = ownerRedisKey(ownerKey)
  const script = `
    redis.call('ZREM', KEYS[1], ARGV[1])
    if redis.call('ZCARD', KEYS[1]) == 0 then
      redis.call('DEL', KEYS[1])
    end
    return 1
  `

  try {
    await redis.eval(script, 1, key, leaseId)
  } catch (error) {
    logger.error('Failed to release distributed owner lease', { ownerKey, error })
  }
}

function queueLength(): number {
  return queueSize
}

function maybeClearDrainRetry() {
  if (queueSize === 0 && queueDrainRetryTimeout) {
    clearTimeout(queueDrainRetryTimeout)
    queueDrainRetryTimeout = null
  }
}

function getOrCreateOwnerState(ownerKey: string, ownerWeight: number): OwnerState {
  const existing = ownerStates.get(ownerKey)
  if (existing) {
    existing.weight = Math.max(existing.weight, ownerWeight)
    return existing
  }

  const ownerState: OwnerState = {
    ownerKey,
    weight: ownerWeight,
    activeExecutions: 0,
    queueHead: null,
    queueTail: null,
    queueLength: 0,
    burstRemaining: 0,
  }
  ownerStates.set(ownerKey, ownerState)
  return ownerState
}

function addOwnerToRing(ownerKey: string) {
  if (queuedOwnerRing.includes(ownerKey)) return
  queuedOwnerRing.push(ownerKey)
}

function removeOwnerFromRing(ownerKey: string) {
  const idx = queuedOwnerRing.indexOf(ownerKey)
  if (idx === -1) return
  queuedOwnerRing.splice(idx, 1)
  if (queuedOwnerRing.length === 0) {
    queuedOwnerCursor = 0
    return
  }
  if (idx < queuedOwnerCursor) {
    queuedOwnerCursor--
  } else if (queuedOwnerCursor >= queuedOwnerRing.length) {
    queuedOwnerCursor = 0
  }
}

function maybeCleanupOwner(ownerKey: string) {
  const owner = ownerStates.get(ownerKey)
  if (!owner) return
  if (owner.queueLength === 0) {
    removeOwnerFromRing(ownerKey)
  }
  if (owner.queueLength === 0 && owner.activeExecutions === 0) {
    ownerStates.delete(ownerKey)
  }
}

function removeQueueNode(node: QueueNode): QueuedExecution {
  const owner = ownerStates.get(node.ownerKey)
  if (!owner) {
    queueNodes.delete(node.value.id)
    queueSize = Math.max(0, queueSize - 1)
    maybeClearDrainRetry()
    return node.value
  }

  const { prev, next, value } = node
  if (prev) prev.next = next
  else owner.queueHead = next
  if (next) next.prev = prev
  else owner.queueTail = prev

  node.prev = null
  node.next = null

  queueNodes.delete(value.id)
  owner.queueLength--
  queueSize--
  maybeCleanupOwner(owner.ownerKey)
  maybeClearDrainRetry()
  return value
}

function shiftQueuedExecutionForOwner(owner: OwnerState): QueuedExecution | null {
  if (!owner.queueHead) return null
  return removeQueueNode(owner.queueHead)
}

function removeQueuedExecutionById(queueId: number): QueuedExecution | null {
  const node = queueNodes.get(queueId)
  if (!node) return null
  return removeQueueNode(node)
}

function pushQueuedExecution(owner: OwnerState, queued: QueuedExecution) {
  const node: QueueNode = {
    ownerKey: owner.ownerKey,
    value: queued,
    prev: owner.queueTail,
    next: null,
  }
  if (owner.queueTail) {
    owner.queueTail.next = node
  } else {
    owner.queueHead = node
  }
  owner.queueTail = node
  owner.queueLength++
  owner.burstRemaining = 0
  addOwnerToRing(owner.ownerKey)
  queueNodes.set(queued.id, node)
  queueSize++
}

function selectOwnerForDispatch(): OwnerState | null {
  if (queuedOwnerRing.length === 0) return null

  let visited = 0
  while (queuedOwnerRing.length > 0 && visited < queuedOwnerRing.length) {
    if (queuedOwnerCursor >= queuedOwnerRing.length) {
      queuedOwnerCursor = 0
    }
    const ownerKey = queuedOwnerRing[queuedOwnerCursor]
    if (!ownerKey) return null

    const owner = ownerStates.get(ownerKey)
    if (!owner) {
      removeOwnerFromRing(ownerKey)
      continue
    }

    if (owner.queueLength === 0) {
      owner.burstRemaining = 0
      removeOwnerFromRing(ownerKey)
      continue
    }

    if (owner.activeExecutions >= MAX_ACTIVE_PER_OWNER) {
      owner.burstRemaining = 0
      queuedOwnerCursor = (queuedOwnerCursor + 1) % queuedOwnerRing.length
      visited++
      continue
    }

    if (owner.burstRemaining <= 0) {
      owner.burstRemaining = owner.weight
    }

    owner.burstRemaining--
    if (owner.burstRemaining <= 0) {
      queuedOwnerCursor = (queuedOwnerCursor + 1) % queuedOwnerRing.length
    }

    return owner
  }

  return null
}

function scheduleDrainRetry() {
  if (queueDrainRetryTimeout || queueSize === 0) return
  queueDrainRetryTimeout = setTimeout(() => {
    queueDrainRetryTimeout = null
    if (queueSize === 0) return
    drainQueue()
  }, QUEUE_RETRY_DELAY_MS)
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
      const owner = ownerStates.get(pending.ownerKey)
      if (owner) {
        owner.activeExecutions = Math.max(0, owner.activeExecutions - 1)
        maybeCleanupOwner(owner.ownerKey)
      }
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
    if (typeof url !== 'string' || url.length === 0) {
      workerInfo?.process.send({
        type: 'fetchResponse',
        fetchId,
        response: JSON.stringify({ error: 'Invalid fetch URL' }),
      })
      return
    }
    if (optionsJson && optionsJson.length > MAX_FETCH_OPTIONS_JSON_CHARS) {
      workerInfo?.process.send({
        type: 'fetchResponse',
        fetchId,
        response: JSON.stringify({
          error: `Fetch options exceed maximum payload size (${MAX_FETCH_OPTIONS_JSON_CHARS} chars)`,
        }),
      })
      return
    }

    let options: IsolatedFetchOptions | undefined
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
    const owner = ownerStates.get(pending.ownerKey)
    if (owner) {
      owner.activeExecutions = Math.max(0, owner.activeExecutions - 1)
      maybeCleanupOwner(owner.ownerKey)
    }
    pending.resolve({
      result: null,
      stdout: '',
      error: { message: 'Code execution failed unexpectedly. Please try again.', name: 'Error' },
    })
    workerInfo.pendingExecutions.delete(id)
  }
  workerInfo.activeExecutions = 0

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
  let spawnSettled = false

  const settleSpawnInProgress = () => {
    if (spawnSettled) {
      return false
    }
    spawnSettled = true
    spawnInProgress--
    return true
  }

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
      settleSpawnInProgress()
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
      settleSpawnInProgress()
      reject(new Error(`Worker file not found at ${workerPath}`))
      return
    }

    import('node:child_process')
      .then(({ spawn }) => {
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
          workers.delete(workerId)
          if (!settleSpawnInProgress()) return
          reject(new Error('Worker failed to start within timeout'))
        }, 10000)

        const readyHandler = (message: unknown) => {
          if (
            typeof message === 'object' &&
            message !== null &&
            (message as { type?: string }).type === 'ready'
          ) {
            if (!settleSpawnInProgress()) {
              proc.off('message', readyHandler)
              return
            }
            workerInfo.ready = true
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
            clearTimeout(startTimeout)
            if (!settleSpawnInProgress()) return

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
      .catch((error) => {
        if (!settleSpawnInProgress()) return
        reject(error instanceof Error ? error : new Error('Failed to load child_process module'))
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
  ownerState: OwnerState,
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
    ownerState.activeExecutions = Math.max(0, ownerState.activeExecutions - 1)
    maybeCleanupOwner(ownerState.ownerKey)
    resolve({
      result: null,
      stdout: '',
      error: { message: `Execution timed out after ${req.timeoutMs}ms`, name: 'TimeoutError' },
    })
    resetWorkerIdleTimeout(workerInfo.id)
    drainQueue()
  }, req.timeoutMs + 1000)

  workerInfo.pendingExecutions.set(execId, { resolve, timeout, ownerKey: ownerState.ownerKey })
  workerInfo.activeExecutions++
  totalActiveExecutions++
  ownerState.activeExecutions++

  try {
    workerInfo.process.send({ type: 'execute', executionId: execId, request: req })
  } catch {
    clearTimeout(timeout)
    workerInfo.pendingExecutions.delete(execId)
    workerInfo.activeExecutions--
    totalActiveExecutions--
    ownerState.activeExecutions = Math.max(0, ownerState.activeExecutions - 1)
    maybeCleanupOwner(ownerState.ownerKey)
    resolve({
      result: null,
      stdout: '',
      error: { message: 'Code execution failed to start. Please try again.', name: 'Error' },
    })
    resetWorkerIdleTimeout(workerInfo.id)
    // Defer to break synchronous recursion: drainQueue → dispatchToWorker → catch → drainQueue
    queueMicrotask(() => drainQueue())
  }
}

function enqueueExecution(
  ownerState: OwnerState,
  req: IsolatedVMExecutionRequest,
  resolve: (result: IsolatedVMExecutionResult) => void
) {
  if (queueLength() >= MAX_QUEUE_SIZE) {
    resolve({
      result: null,
      stdout: '',
      error: {
        message: 'Code execution is at capacity. Please try again in a moment.',
        name: 'Error',
      },
    })
    return
  }
  if (ownerState.queueLength >= MAX_QUEUED_PER_OWNER) {
    resolve({
      result: null,
      stdout: '',
      error: {
        message:
          'Too many concurrent code executions. Please wait for some to complete before running more.',
        name: 'Error',
      },
    })
    return
  }

  const queueId = ++queueIdCounter
  const queueTimeout = setTimeout(() => {
    const queued = removeQueuedExecutionById(queueId)
    if (!queued) return
    resolve({
      result: null,
      stdout: '',
      error: {
        message: 'Code execution timed out waiting for an available worker. Please try again.',
        name: 'Error',
      },
    })
  }, QUEUE_TIMEOUT_MS)

  pushQueuedExecution(ownerState, {
    id: queueId,
    ownerKey: ownerState.ownerKey,
    req,
    resolve,
    queueTimeout,
  })
  logger.info('Execution queued', {
    queueLength: queueLength(),
    ownerKey: ownerState.ownerKey,
    ownerQueueLength: ownerState.queueLength,
    totalActive: totalActiveExecutions,
    poolSize: workers.size,
  })
  drainQueue()
}

/**
 * Called after every completion or worker spawn — dispatches queued
 * executions to available workers.
 */
function drainQueue() {
  while (queueLength() > 0 && totalActiveExecutions < MAX_CONCURRENT) {
    const worker = selectWorker()
    if (!worker) {
      const currentPoolSize = workers.size + spawnInProgress
      if (currentPoolSize < POOL_SIZE) {
        spawnWorker()
          .then(() => drainQueue())
          .catch((err) => {
            logger.error('Failed to spawn worker during drain', { err })
            scheduleDrainRetry()
          })
      }
      break
    }

    const owner = selectOwnerForDispatch()
    if (!owner) {
      scheduleDrainRetry()
      break
    }

    const queued = shiftQueuedExecutionForOwner(owner)
    if (!queued) {
      owner.burstRemaining = 0
      maybeCleanupOwner(owner.ownerKey)
      continue
    }
    clearTimeout(queued.queueTimeout)
    dispatchToWorker(worker, owner, queued.req, queued.resolve)
  }
}

/**
 * Execute JavaScript code in an isolated V8 isolate via Node.js subprocess.
 */
export async function executeInIsolatedVM(
  req: IsolatedVMExecutionRequest
): Promise<IsolatedVMExecutionResult> {
  const ownerKey = normalizeOwnerKey(req.ownerKey)
  const ownerWeight = normalizeOwnerWeight(req.ownerWeight)
  const ownerState = getOrCreateOwnerState(ownerKey, ownerWeight)

  const distributedLeaseId = `${req.requestId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  const leaseAcquireResult = await tryAcquireDistributedLease(
    ownerKey,
    distributedLeaseId,
    req.timeoutMs
  )
  if (leaseAcquireResult === 'limit_exceeded') {
    maybeCleanupOwner(ownerKey)
    return {
      result: null,
      stdout: '',
      error: {
        message:
          'Too many concurrent code executions. Please wait for some to complete before running more.',
        name: 'Error',
      },
    }
  }
  if (leaseAcquireResult === 'unavailable') {
    maybeCleanupOwner(ownerKey)
    return {
      result: null,
      stdout: '',
      error: {
        message: 'Code execution is temporarily unavailable. Please try again in a moment.',
        name: 'Error',
      },
    }
  }

  let settled = false
  const releaseLease = () => {
    if (settled) return
    settled = true
    releaseDistributedLease(ownerKey, distributedLeaseId).catch((error) => {
      logger.error('Failed to release distributed lease', { ownerKey, error })
    })
  }

  return new Promise<IsolatedVMExecutionResult>((resolve) => {
    const resolveWithRelease = (result: IsolatedVMExecutionResult) => {
      releaseLease()
      resolve(result)
    }

    if (
      totalActiveExecutions >= MAX_CONCURRENT ||
      ownerState.activeExecutions >= MAX_ACTIVE_PER_OWNER
    ) {
      enqueueExecution(ownerState, req, resolveWithRelease)
      return
    }

    acquireWorker()
      .then((workerInfo) => {
        if (!workerInfo) {
          enqueueExecution(ownerState, req, resolveWithRelease)
          return
        }

        dispatchToWorker(workerInfo, ownerState, req, resolveWithRelease)
        if (queueLength() > 0) {
          drainQueue()
        }
      })
      .catch((error) => {
        logger.error('Failed to acquire worker for execution', { error, ownerKey })
        enqueueExecution(ownerState, req, resolveWithRelease)
      })
  }).finally(() => {
    releaseLease()
    if (ownerState.queueLength === 0 && ownerState.activeExecutions === 0) {
      maybeCleanupOwner(ownerState.ownerKey)
    }
  })
}
