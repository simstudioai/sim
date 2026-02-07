import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

type MockProc = EventEmitter & {
  connected: boolean
  stderr: EventEmitter
  send: (message: unknown) => boolean
  kill: () => boolean
}

type SpawnFactory = () => MockProc
type RedisEval = (...args: any[]) => unknown | Promise<unknown>
type SecureFetchImpl = (...args: any[]) => unknown | Promise<unknown>

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

async function loadExecutionModule(options: {
  envOverrides?: Record<string, string>
  spawns: SpawnFactory[]
  redisEvalImpl?: RedisEval
  secureFetchImpl?: SecureFetchImpl
}) {
  vi.resetModules()

  const spawnQueue = [...options.spawns]
  const spawnMock = vi.fn(() => {
    const next = spawnQueue.shift()
    if (!next) {
      throw new Error('No mock spawn factory configured')
    }
    return next() as any
  })

  vi.doMock('@sim/logger', () => ({
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }))

  const secureFetchMock = vi.fn(
    options.secureFetchImpl ??
      (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map<string, string>(),
        text: async () => '',
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0),
      }))
  )
  vi.doMock('@/lib/core/security/input-validation.server', () => ({
    secureFetchWithValidation: secureFetchMock,
  }))

  vi.doMock('@/lib/core/config/env', () => ({
    env: {
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
      ...(options.envOverrides ?? {}),
    },
  }))

  const redisEval = options.redisEvalImpl ? vi.fn(options.redisEvalImpl) : undefined
  vi.doMock('@/lib/core/config/redis', () => ({
    getRedisClient: vi.fn(() =>
      redisEval
        ? ({
            eval: redisEval,
          } as any)
        : null
    ),
  }))

  vi.doMock('node:child_process', () => ({
    execSync: vi.fn(() => Buffer.from('v23.11.0')),
    spawn: spawnMock,
  }))

  const mod = await import('./isolated-vm')
  return { ...mod, spawnMock, secureFetchMock }
}

describe('isolated-vm scheduler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
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
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_QUEUE_SIZE: '1',
        IVM_QUEUE_TIMEOUT_MS: '200',
      },
      spawns: [createStartupFailureProc, createStartupFailureProc, createStartupFailureProc],
    })

    const firstPromise = executeInIsolatedVM({
      code: 'return 1',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-2',
      ownerKey: 'user:a',
    })

    await new Promise((resolve) => setTimeout(resolve, 25))

    const second = await executeInIsolatedVM({
      code: 'return 2',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-3',
      ownerKey: 'user:b',
    })

    expect(second.error?.message).toContain('at capacity')

    const first = await firstPromise
    expect(first.error?.message).toContain('timed out waiting')
  })

  it('enforces per-owner queued limit', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_QUEUED_PER_OWNER: '1',
        IVM_QUEUE_TIMEOUT_MS: '200',
      },
      spawns: [createStartupFailureProc, createStartupFailureProc, createStartupFailureProc],
    })

    const firstPromise = executeInIsolatedVM({
      code: 'return 1',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-4',
      ownerKey: 'user:hog',
    })

    await new Promise((resolve) => setTimeout(resolve, 25))

    const second = await executeInIsolatedVM({
      code: 'return 2',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-5',
      ownerKey: 'user:hog',
    })

    expect(second.error?.message).toContain('Too many concurrent')

    const first = await firstPromise
    expect(first.error?.message).toContain('timed out waiting')
  })

  it('enforces distributed owner in-flight lease limit when Redis is configured', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_DISTRIBUTED_MAX_INFLIGHT_PER_OWNER: '1',
        REDIS_URL: 'redis://localhost:6379',
      },
      spawns: [() => createReadyProc('ok')],
      redisEvalImpl: (...args: any[]) => {
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

  it('fails closed when Redis is configured but unavailable', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        REDIS_URL: 'redis://localhost:6379',
      },
      spawns: [() => createReadyProc('ok')],
    })

    const result = await executeInIsolatedVM({
      code: 'return "blocked"',
      params: {},
      envVars: {},
      contextVariables: {},
      timeoutMs: 100,
      requestId: 'req-7',
      ownerKey: 'user:redis-down',
    })

    expect(result.error?.message).toContain('temporarily unavailable')
  })

  it('fails closed when Redis lease evaluation errors', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        REDIS_URL: 'redis://localhost:6379',
      },
      spawns: [() => createReadyProc('ok')],
      redisEvalImpl: (...args: any[]) => {
        const script = String(args[0] ?? '')
        if (script.includes('ZREMRANGEBYSCORE')) {
          throw new Error('redis timeout')
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
      requestId: 'req-8',
      ownerKey: 'user:redis-error',
    })

    expect(result.error?.message).toContain('temporarily unavailable')
  })

  it('applies weighted owner scheduling when draining queued executions', async () => {
    const { executeInIsolatedVM } = await loadExecutionModule({
      envOverrides: {
        IVM_MAX_PER_WORKER: '1',
      },
      spawns: [() => createReadyProcWithDelay(10)],
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
