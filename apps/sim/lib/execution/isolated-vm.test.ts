/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events'
import {
  inputValidationMock,
  inputValidationMockFns,
  redisConfigMock,
  redisConfigMockFns,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockProc = EventEmitter & {
  connected: boolean
  stderr: EventEmitter
  send: (message: unknown) => boolean
  kill: () => boolean
}

type SpawnFactory = () => MockProc
type RedisEval = (...args: unknown[]) => unknown | Promise<unknown>
type SecureFetchImpl = (...args: unknown[]) => unknown | Promise<unknown>

function createBaseProc(): MockProc {
  const proc = new EventEmitter() as MockProc
  proc.connected = true
  proc.stderr = new EventEmitter()
  proc.send = () => true
  proc.kill = () => {
    if (!proc.connected) return true
    proc.connected = false
    setImmediate(() => proc.emit('exit', 0))
    return true
  }
  return proc
}

function createStartupFailureProc(): MockProc {
  const proc = createBaseProc()
  setImmediate(() => {
    proc.connected = false
    proc.emit('exit', 1)
  })
  return proc
}

function createReadyProc(result: unknown): MockProc {
  const proc = createBaseProc()
  proc.send = (message: unknown) => {
    const msg = message as { type?: string; executionId?: number }
    if (msg.type === 'execute') {
      setImmediate(() => {
        proc.emit('message', {
          type: 'result',
          executionId: msg.executionId,
          result: { result, stdout: '' },
        })
      })
    }
    return true
  }
  setImmediate(() => proc.emit('message', { type: 'ready' }))
  return proc
}

function createReadyProcWithDelay(delayMs: number): MockProc {
  const proc = createBaseProc()
  proc.send = (message: unknown) => {
    const msg = message as { type?: string; executionId?: number; request?: { requestId?: string } }
    if (msg.type === 'execute') {
      setTimeout(() => {
        proc.emit('message', {
          type: 'result',
          executionId: msg.executionId,
          result: { result: msg.request?.requestId ?? 'unknown', stdout: '' },
        })
      }, delayMs)
    }
    return true
  }
  setImmediate(() => proc.emit('message', { type: 'ready' }))
  return proc
}

type ControllableReadyProc = {
  spawn: SpawnFactory
  dispatched: Promise<void>
  release: (result?: unknown) => void
}

/**
 * A ready worker whose execution is held open until {@link ControllableReadyProc.release}
 * is called. {@link ControllableReadyProc.dispatched} resolves the moment the worker
 * receives its `execute` message — i.e. once the scheduler has counted the execution as
 * active — giving tests a deterministic, event-driven signal that the concurrency slot is
 * occupied without relying on wall-clock delays. The proc is built inside {@link spawn} so
 * its `ready` event is emitted only after the module attaches its listeners.
 */
function createControllableReadyProc(): ControllableReadyProc {
  let markDispatched: () => void = () => {}
  const dispatched = new Promise<void>((resolve) => {
    markDispatched = resolve
  })
  let proc: MockProc | undefined
  let lastExecutionId = 0

  const spawn: SpawnFactory = () => {
    const current = createBaseProc()
    current.send = (message: unknown) => {
      const msg = message as { type?: string; executionId?: number }
      if (msg.type === 'execute') {
        lastExecutionId = msg.executionId ?? 0
        markDispatched()
      }
      return true
    }
    setImmediate(() => current.emit('message', { type: 'ready' }))
    proc = current
    return current
  }

  const release = (result: unknown = 'released') => {
    proc?.emit('message', {
      type: 'result',
      executionId: lastExecutionId,
      result: { result, stdout: '' },
    })
  }

  return { spawn, dispatched, release }
}

function createReadyFetchProxyProc(fetchMessage: { url: string; optionsJson?: string }): MockProc {
  const proc = createBaseProc()
  let currentExecutionId = 0

  proc.send = (message: unknown) => {
    const msg = message as { type?: string; executionId?: number; request?: { requestId?: string } }

    if (msg.type === 'execute') {
      currentExecutionId = msg.executionId ?? 0
      setImmediate(() => {
        proc.emit('message', {
          type: 'fetch',
          fetchId: 1,
          requestId: msg.request?.requestId ?? 'fetch-test',
          url: fetchMessage.url,
          optionsJson: fetchMessage.optionsJson,
        })
      })
      return true
    }

    if (msg.type === 'fetchResponse') {
      const fetchResponse = message as { response?: string }
      setImmediate(() => {
        proc.emit('message', {
          type: 'result',
          executionId: currentExecutionId,
          result: { result: fetchResponse.response ?? '', stdout: '' },
        })
      })
      return true
    }

    return true
  }

  setImmediate(() => proc.emit('message', { type: 'ready' }))
  return proc
}

const { mockSpawn, mockExecSync, mockSanitizeUrl, mockEnv } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecSync: vi.fn(() => Buffer.from('v23.11.0')),
  mockSanitizeUrl: vi.fn((url: string) => url),
  mockEnv: {
    IVM_POOL_SIZE: '1',
    IVM_MAX_CONCURRENT: '100',
    IVM_MAX_PER_WORKER: '100',
    IVM_WORKER_IDLE_TIMEOUT_MS: '60000',
    IVM_MAX_QUEUE_SIZE: '10',
    IVM_MAX_ACTIVE_PER_OWNER: '100',
    IVM_MAX_QUEUED_PER_OWNER: '10',
    IVM_MAX_OWNER_WEIGHT: '5',
    IVM_DISTRIBUTED_MAX_INFLIGHT_PER_OWNER: '100',
    IVM_DISTRIBUTED_LEASE_MIN_TTL_MS: '1000',
    IVM_QUEUE_TIMEOUT_MS: '1000',
    IVM_MAX_FETCH_RESPONSE_BYTES: '',
    IVM_MAX_FETCH_RESPONSE_CHARS: '',
    IVM_MAX_FETCH_URL_LENGTH: '',
    IVM_MAX_FETCH_OPTIONS_JSON_CHARS: '',
    REDIS_URL: '',
  } as Record<string, string>,
}))

const mockSecureFetch = inputValidationMockFns.mockSecureFetchWithValidation
const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/core/utils/logging', () => ({
  sanitizeUrlForLog: mockSanitizeUrl,
}))
vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
}))
vi.mock('@/lib/core/config/redis', () => redisConfigMock)
vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
  spawn: mockSpawn,
}))

async function loadExecutionModule(options: {
  envOverrides?: Record<string, string>
  spawns: SpawnFactory[]
  redisEvalImpl?: RedisEval
  secureFetchImpl?: SecureFetchImpl
}) {
  const spawnQueue = [...options.spawns]
  mockSpawn.mockImplementation(() => {
    const next = spawnQueue.shift()
    if (!next) {
      throw new Error('No mock spawn factory configured')
    }
    return next() as ReturnType<typeof mockSpawn>
  })

  if (options.secureFetchImpl) {
    mockSecureFetch.mockImplementation(options.secureFetchImpl)
  } else {
    mockSecureFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map<string, string>(),
      text: async () => '',
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
  }

  Object.assign(mockEnv, {
    IVM_POOL_SIZE: '1',
    IVM_MAX_CONCURRENT: '100',
    IVM_MAX_PER_WORKER: '100',
    IVM_WORKER_IDLE_TIMEOUT_MS: '60000',
    IVM_MAX_QUEUE_SIZE: '10',
    IVM_MAX_ACTIVE_PER_OWNER: '100',
    IVM_MAX_QUEUED_PER_OWNER: '10',
    IVM_MAX_OWNER_WEIGHT: '5',
    IVM_DISTRIBUTED_MAX_INFLIGHT_PER_OWNER: '100',
    IVM_DISTRIBUTED_LEASE_MIN_TTL_MS: '1000',
    IVM_QUEUE_TIMEOUT_MS: '1000',
    IVM_MAX_FETCH_RESPONSE_BYTES: '',
    IVM_MAX_FETCH_RESPONSE_CHARS: '',
    IVM_MAX_FETCH_URL_LENGTH: '',
    IVM_MAX_FETCH_OPTIONS_JSON_CHARS: '',
    REDIS_URL: '',
    ...(options.envOverrides ?? {}),
  })

  const redisEval = options.redisEvalImpl ? vi.fn(options.redisEvalImpl) : undefined
  mockGetRedisClient.mockImplementation(() =>
    redisEval
      ? ({
          eval: redisEval,
        } as unknown)
      : null
  )

  vi.resetModules()

  const mod = await import('@/lib/execution/isolated-vm')
  return { ...mod, spawnMock: mockSpawn, secureFetchMock: mockSecureFetch }
}

describe('isolated-vm scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('recovers from an initial spawn failure and drains queued work', async () => {
    const { executeInIsolatedVM, spawnMock } = await loadExecutionModule({
      spawns: [createStartupFailureProc, () => createReadyProc('ok')],
    })

    const result = await executeInIsolatedVM({
      code: 'return "ok"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-1',
    })

    expect(result.error).toBeUndefined()
    expect(result.result).toBe('ok')
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('rejects new requests when the queue is full', async () => {
    const holder = createControllableReadyProc()
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_CONCURRENT: '1',
        IVM_MAX_QUEUE_SIZE: '1',
        IVM_QUEUE_TIMEOUT_MS: '50',
      },
      spawns: [holder.spawn],
    })

    // Occupy the single global concurrency slot with an active execution. Awaiting
    // `dispatched` is event-driven, so the queue state below is fully deterministic.
    const holderPromise = executeInIsolatedVM({
      code: 'return "holder"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 1000,
      requestId: 'req-holder',
      ownerKey: 'user:holder',
    })
    await holder.dispatched

    // With the slot held, this request lands in the queue (size 1, now full)...
    const queuedPromise = executeInIsolatedVM({
      code: 'return 1',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-2',
      ownerKey: 'user:a',
    })

    // ...and this one overflows it and is rejected immediately.
    const rejected = await executeInIsolatedVM({
      code: 'return 2',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-3',
      ownerKey: 'user:b',
    })

    expect(rejected.error?.message).toContain('at capacity')

    const queued = await queuedPromise
    expect(queued.error?.message).toContain('timed out waiting')

    holder.release()
    await holderPromise
  })

  it('enforces per-owner queued limit', async () => {
    const holder = createControllableReadyProc()
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_CONCURRENT: '1',
        IVM_MAX_QUEUED_PER_OWNER: '1',
        IVM_QUEUE_TIMEOUT_MS: '50',
      },
      spawns: [holder.spawn],
    })

    // Hold the single global slot with one of the owner's executions so the next
    // requests deterministically queue instead of dispatching.
    const holderPromise = executeInIsolatedVM({
      code: 'return "holder"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 1000,
      requestId: 'req-holder',
      ownerKey: 'user:hog',
    })
    await holder.dispatched

    // First queued request for the owner fills their per-owner queue allowance...
    const queuedPromise = executeInIsolatedVM({
      code: 'return 1',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-4',
      ownerKey: 'user:hog',
    })

    // ...so the second is rejected for exceeding the per-owner queued limit.
    const rejected = await executeInIsolatedVM({
      code: 'return 2',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-5',
      ownerKey: 'user:hog',
    })

    expect(rejected.error?.message).toContain('Too many concurrent')

    const queued = await queuedPromise
    expect(queued.error?.message).toContain('timed out waiting')

    holder.release()
    await holderPromise
  })

  it('enforces distributed owner in-flight lease limit when Redis is configured', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_DISTRIBUTED_MAX_INFLIGHT_PER_OWNER: '1',
        REDIS_URL: 'redis://localhost:6379',
      },
      spawns: [() => createReadyProc('ok')],
      redisEvalImpl: (...args: unknown[]) => {
        const script = String(args[0] ?? '')
        if (script.includes('ZREMRANGEBYSCORE')) {
          return 0
        }
        return 1
      },
    })

    const result = await executeInIsolatedVM({
      code: 'return "blocked"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-6',
      ownerKey: 'user:distributed',
    })

    expect(result.error?.message).toContain('Too many concurrent')
  })

  it('falls back to local execution when Redis is configured but unavailable', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        REDIS_URL: 'redis://localhost:6379',
      },
      spawns: [() => createReadyProc('ok')],
    })

    const result = await executeInIsolatedVM({
      code: 'return "ok"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-7',
      ownerKey: 'user:redis-down',
    })

    expect(result.error).toBeUndefined()
    expect(result.result).toBe('ok')
  })

  it('falls back to local execution when Redis lease evaluation errors', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        REDIS_URL: 'redis://localhost:6379',
      },
      spawns: [() => createReadyProc('ok')],
      redisEvalImpl: (...args: unknown[]) => {
        const script = String(args[0] ?? '')
        if (script.includes('ZREMRANGEBYSCORE')) {
          throw new Error('redis timeout')
        }
        return 1
      },
    })

    const result = await executeInIsolatedVM({
      code: 'return "ok"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-8',
      ownerKey: 'user:redis-error',
    })

    expect(result.error).toBeUndefined()
    expect(result.result).toBe('ok')
  })

  it('applies weighted owner scheduling when draining queued executions', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_PER_WORKER: '1',
      },
      spawns: [() => createReadyProcWithDelay(1)],
    })

    const completionOrder: string[] = []
    const pushCompletion = (label: string) => (res: { result: unknown }) => {
      completionOrder.push(String(res.result ?? label))
      return res
    }

    const p1 = executeInIsolatedVM({
      code: 'return 1',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 500,
      requestId: 'a-1',
      ownerKey: 'user:a',
      ownerWeight: 2,
    }).then(pushCompletion('a-1'))

    const p2 = executeInIsolatedVM({
      code: 'return 2',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 500,
      requestId: 'a-2',
      ownerKey: 'user:a',
      ownerWeight: 2,
    }).then(pushCompletion('a-2'))

    const p3 = executeInIsolatedVM({
      code: 'return 3',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 500,
      requestId: 'b-1',
      ownerKey: 'user:b',
      ownerWeight: 1,
    }).then(pushCompletion('b-1'))

    const p4 = executeInIsolatedVM({
      code: 'return 4',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 500,
      requestId: 'b-2',
      ownerKey: 'user:b',
      ownerWeight: 1,
    }).then(pushCompletion('b-2'))

    const p5 = executeInIsolatedVM({
      code: 'return 5',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 500,
      requestId: 'a-3',
      ownerKey: 'user:a',
      ownerWeight: 2,
    }).then(pushCompletion('a-3'))

    await Promise.all([p1, p2, p3, p4, p5])

    expect(completionOrder.slice(0, 3)).toEqual(['a-1', 'a-2', 'a-3'])
    expect(completionOrder).toEqual(['a-1', 'a-2', 'a-3', 'b-1', 'b-2'])
  })

  it('rejects oversized fetch options payloads before outbound call', async () => {
    const { executeInIsolatedVM, secureFetchMock } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_FETCH_OPTIONS_JSON_CHARS: '50',
      },
      spawns: [
        () =>
          createReadyFetchProxyProc({
            url: 'https://example.com',
            optionsJson: 'x'.repeat(100),
          }),
      ],
    })

    const result = await executeInIsolatedVM({
      code: 'return "fetch-options"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-fetch-options',
    })

    const payload = JSON.parse(String(result.result))
    expect(payload.error).toContain('Fetch options exceed maximum payload size')
    expect(secureFetchMock).not.toHaveBeenCalled()
  })

  it('rejects overly long fetch URLs before outbound call', async () => {
    const { executeInIsolatedVM, secureFetchMock } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_FETCH_URL_LENGTH: '30',
      },
      spawns: [
        () =>
          createReadyFetchProxyProc({
            url: 'https://example.com/path/to/a/very/long/resource',
          }),
      ],
    })

    const result = await executeInIsolatedVM({
      code: 'return "fetch-url"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-fetch-url',
    })

    const payload = JSON.parse(String(result.result))
    expect(payload.error).toContain('fetch URL exceeds maximum length')
    expect(secureFetchMock).not.toHaveBeenCalled()
  })
})
