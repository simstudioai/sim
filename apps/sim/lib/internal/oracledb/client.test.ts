/**
 * @vitest-environment node
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const processMocks = vi.hoisted(() => ({ spawn: vi.fn() }))
const proxyMocks = vi.hoisted(() => ({
  close: vi.fn(),
  createOracleConnectProxy: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: processMocks.spawn }))
vi.mock('@/lib/internal/oracledb/connect-proxy', () => ({
  createOracleConnectProxy: proxyMocks.createOracleConnectProxy,
}))

import { executeOracleStatements, oracleClientInternals } from '@/lib/internal/oracledb/client'
import { ORACLE_MAX_WORKER_RESPONSE_BYTES } from '@/lib/internal/oracledb/worker-protocol'

const CONNECTION = {
  host: 'db.example.com',
  port: 1521,
  protocol: 'tcp',
  connectionType: 'serviceName',
  serviceName: 'FREEPDB1',
  username: 'application',
  password: 'secret',
  connectionTimeout: 15000,
} as const

function fakeChild(onInput: (child: FakeChild) => void): ChildProcessWithoutNullStreams {
  const child = new FakeChild()
  child.stdin.once('finish', () => onInput(child))
  return child as unknown as ChildProcessWithoutNullStreams
}

class FakeChild extends EventEmitter {
  private readonly closeOnSignal: NodeJS.Signals | 'any' | undefined
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    if (this.closeOnSignal === 'any' || this.closeOnSignal === signal) {
      this.signalCode = signal
      void Promise.resolve().then(() => this.emit('close', null, signal))
    }
    return true
  })

  constructor(closeOnSignal: NodeJS.Signals | 'any' | undefined = 'any') {
    super()
    this.closeOnSignal = closeOnSignal
  }

  succeed(response: unknown): void {
    this.stdout.end(JSON.stringify(response))
    this.exitCode = 0
    void Promise.resolve().then(() => this.emit('close', 0, null))
  }

  finishWithOutput(output: string): void {
    this.stdout.end(output)
    this.exitCode = 1
    void Promise.resolve().then(() => this.emit('close', 1, null))
  }
}

describe('Oracle worker client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    proxyMocks.close.mockResolvedValue(undefined)
    proxyMocks.createOracleConnectProxy.mockResolvedValue({
      host: '127.0.0.1',
      port: 32000,
      close: proxyMocks.close,
      getFailureReason: () => undefined,
    })
  })

  it('resolves the source worker from the application cwd', () => {
    expect(oracleClientInternals.resolveOracleWorkerPath()).toMatch(
      /apps\/sim\/lib\/internal\/oracledb\/oracle-worker\.cjs$/
    )
  })

  it('keeps draining noisy stderr and accepts the bounded protocol response', async () => {
    processMocks.spawn.mockReturnValue(
      fakeChild((child) => {
        child.stderr.write(Buffer.alloc(128 * 1024, 120))
        child.stderr.end()
        child.succeed({
          protocolVersion: 1,
          ok: true,
          results: [{ rows: [{ VALUE: '1' }], rowCount: 1 }],
        })
      })
    )

    await expect(
      executeOracleStatements(CONNECTION, [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }])
    ).resolves.toEqual([{ rows: [{ VALUE: '1' }], rowCount: 1 }])
    expect(proxyMocks.close).toHaveBeenCalledOnce()
  })

  it('sends credentials and the in-memory wallet only over worker stdin', async () => {
    let stdin = ''
    const child = new FakeChild()
    child.stdin.on('data', (chunk: Buffer) => {
      stdin += chunk.toString('utf8')
    })
    child.stdin.once('finish', () => {
      child.succeed({ protocolVersion: 1, ok: true, results: [{ rows: [], rowCount: 0 }] })
    })
    processMocks.spawn.mockReturnValue(child as unknown as ChildProcessWithoutNullStreams)
    const secureConnection = {
      ...CONNECTION,
      protocol: 'tcps' as const,
      password: 'db-secret-value',
      walletContent:
        '-----BEGIN CERTIFICATE-----\nin-memory-wallet-value\n-----END CERTIFICATE-----',
      walletPassword: 'wallet-secret-value',
    }

    await executeOracleStatements(secureConnection, [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }])

    const [binary, args, options] = processMocks.spawn.mock.calls[0]
    const processSurface = JSON.stringify({ binary, args, env: options.env })
    expect(processSurface).not.toContain('db-secret-value')
    expect(processSurface).not.toContain('in-memory-wallet-value')
    expect(processSurface).not.toContain('wallet-secret-value')
    expect(stdin).toContain('db-secret-value')
    expect(stdin).toContain('in-memory-wallet-value')
    expect(stdin).toContain('wallet-secret-value')
    expect(options.env).toEqual({ PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV })
  })

  it('closes the abort-listener race immediately after spawn', async () => {
    const controller = new AbortController()
    let child: FakeChild | undefined
    processMocks.spawn.mockImplementation(() => {
      child = new FakeChild()
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return child as unknown as ChildProcessWithoutNullStreams
    })

    await expect(
      executeOracleStatements(
        CONNECTION,
        [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }],
        {},
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(child?.kill).toHaveBeenCalledWith('SIGTERM')
    expect(proxyMocks.close).toHaveBeenCalledOnce()
  })

  it('rejects malformed worker output and still closes the proxy', async () => {
    processMocks.spawn.mockReturnValue(fakeChild((child) => child.finishWithOutput('not-json')))

    await expect(
      executeOracleStatements(CONNECTION, [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }])
    ).rejects.toThrow('malformed output')
    expect(proxyMocks.close).toHaveBeenCalledOnce()
  })

  it('rejects empty worker output and still closes the proxy', async () => {
    processMocks.spawn.mockReturnValue(fakeChild((child) => child.finishWithOutput('')))

    await expect(
      executeOracleStatements(CONNECTION, [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }])
    ).rejects.toThrow('exited without a response')
    expect(proxyMocks.close).toHaveBeenCalledOnce()
  })

  it('rejects oversized worker output, force-kills the child, and closes the proxy', async () => {
    let child: FakeChild | undefined
    processMocks.spawn.mockImplementation(() => {
      child = fakeChild((runningChild) => {
        runningChild.stdout.write(Buffer.alloc(ORACLE_MAX_WORKER_RESPONSE_BYTES + 1, 120))
      }) as unknown as FakeChild
      return child as unknown as ChildProcessWithoutNullStreams
    })

    await expect(
      executeOracleStatements(CONNECTION, [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }])
    ).rejects.toThrow('response exceeded')
    expect(child?.kill).toHaveBeenCalledWith('SIGKILL')
    expect(proxyMocks.close).toHaveBeenCalledOnce()
  })

  it('rejects incomplete and explicit-error responses and closes each proxy', async () => {
    processMocks.spawn.mockReturnValueOnce(
      fakeChild((child) => child.succeed({ protocolVersion: 1, ok: true, results: [] }))
    )
    await expect(
      executeOracleStatements(CONNECTION, [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }])
    ).rejects.toThrow('incomplete result')

    processMocks.spawn.mockReturnValueOnce(
      fakeChild((child) =>
        child.succeed({
          protocolVersion: 1,
          ok: false,
          error: { message: 'permission denied' },
        })
      )
    )
    await expect(
      executeOracleStatements(CONNECTION, [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }])
    ).rejects.toThrow('permission denied')
    expect(proxyMocks.close).toHaveBeenCalledTimes(2)
  })

  it('terminates a worker that exceeds the overall operation deadline', async () => {
    vi.useFakeTimers()
    let child: FakeChild | undefined
    processMocks.spawn.mockImplementation(() => {
      child = new FakeChild()
      return child as unknown as ChildProcessWithoutNullStreams
    })

    try {
      const result = executeOracleStatements(CONNECTION, [
        { sql: 'SELECT 1 FROM DUAL', maxRows: 1 },
      ])
      const rejection = expect(result).rejects.toThrow('execution timeout')
      await vi.advanceTimersByTimeAsync(0)
      expect(child).toBeDefined()
      await vi.advanceTimersByTimeAsync(oracleClientInternals.operationTimeout(15000, 1))
      await rejection
      expect(child?.kill).toHaveBeenCalledWith('SIGTERM')
      expect(proxyMocks.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('force-kills a noncooperative worker after the two-second grace period', async () => {
    vi.useFakeTimers()
    let child: FakeChild | undefined
    processMocks.spawn.mockImplementation(() => {
      child = new FakeChild('SIGKILL')
      return child as unknown as ChildProcessWithoutNullStreams
    })

    try {
      const result = executeOracleStatements(CONNECTION, [
        { sql: 'SELECT 1 FROM DUAL', maxRows: 1 },
      ])
      const rejection = expect(result).rejects.toThrow('execution timeout')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(oracleClientInternals.operationTimeout(15000, 1))
      expect(child?.kill).toHaveBeenCalledWith('SIGTERM')
      expect(child?.kill).not.toHaveBeenCalledWith('SIGKILL')
      await vi.advanceTimersByTimeAsync(1_999)
      expect(child?.kill).not.toHaveBeenCalledWith('SIGKILL')
      await vi.advanceTimersByTimeAsync(1)
      await rejection
      expect(child?.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
      expect(proxyMocks.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts worker queue residence against the overall operation deadline', async () => {
    vi.useFakeTimers()
    const releaseFirst = await oracleClientInternals.acquireWorkerSlot()
    const releaseSecond = await oracleClientInternals.acquireWorkerSlot()
    let child: FakeChild | undefined
    processMocks.spawn.mockImplementation(() => {
      child = new FakeChild()
      return child as unknown as ChildProcessWithoutNullStreams
    })

    try {
      const totalTimeout = oracleClientInternals.operationTimeout(15000, 1)
      const result = executeOracleStatements(CONNECTION, [
        { sql: 'SELECT 1 FROM DUAL', maxRows: 1 },
      ])
      const rejection = expect(result).rejects.toThrow('execution timeout')

      await vi.advanceTimersByTimeAsync(25_000)
      releaseFirst()
      await vi.advanceTimersByTimeAsync(0)
      expect(child).toBeDefined()

      await vi.advanceTimersByTimeAsync(totalTimeout - 25_000)
      await rejection
      expect(child?.kill).toHaveBeenCalledWith('SIGTERM')
      expect(proxyMocks.close).toHaveBeenCalledOnce()
    } finally {
      releaseFirst()
      releaseSecond()
      vi.useRealTimers()
    }
    expect(oracleClientInternals.activeWorkers()).toBe(0)
  })

  it('caps request-scoped Node workers at two per application process', async () => {
    const releaseFirst = await oracleClientInternals.acquireWorkerSlot()
    const releaseSecond = await oracleClientInternals.acquireWorkerSlot()
    const third = oracleClientInternals.acquireWorkerSlot()

    expect(oracleClientInternals.activeWorkers()).toBe(2)
    expect(oracleClientInternals.pendingWorkers()).toBe(1)

    releaseFirst()
    const releaseThird = await third
    expect(oracleClientInternals.activeWorkers()).toBe(2)
    expect(oracleClientInternals.pendingWorkers()).toBe(0)

    releaseSecond()
    releaseThird()
    expect(oracleClientInternals.activeWorkers()).toBe(0)
  })

  it('removes a cancelled request while it waits for a worker slot', async () => {
    const releaseFirst = await oracleClientInternals.acquireWorkerSlot()
    const releaseSecond = await oracleClientInternals.acquireWorkerSlot()
    const controller = new AbortController()
    const waiting = oracleClientInternals.acquireWorkerSlot(controller.signal)

    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(oracleClientInternals.pendingWorkers()).toBe(0)
    releaseFirst()
    releaseSecond()
    expect(oracleClientInternals.activeWorkers()).toBe(0)
  })

  it('rejects admission beyond the bounded pending-worker queue', async () => {
    const releaseFirst = await oracleClientInternals.acquireWorkerSlot()
    const releaseSecond = await oracleClientInternals.acquireWorkerSlot()
    const pending = Array.from({ length: oracleClientInternals.MAX_PENDING_WORKERS }, () =>
      oracleClientInternals.acquireWorkerSlot()
    )

    await expect(oracleClientInternals.acquireWorkerSlot()).rejects.toThrow('capacity is busy')
    expect(oracleClientInternals.pendingWorkers()).toBe(oracleClientInternals.MAX_PENDING_WORKERS)

    releaseFirst()
    for (const waiting of pending) {
      const release = await waiting
      release()
    }
    releaseSecond()
    expect(oracleClientInternals.activeWorkers()).toBe(0)
    expect(oracleClientInternals.pendingWorkers()).toBe(0)
  })

  it('expires a queued request without consuming a later worker slot', async () => {
    vi.useFakeTimers()
    const releaseFirst = await oracleClientInternals.acquireWorkerSlot()
    const releaseSecond = await oracleClientInternals.acquireWorkerSlot()

    try {
      const waiting = oracleClientInternals.acquireWorkerSlot()
      const rejection = expect(waiting).rejects.toThrow('queue wait exceeded 30 seconds')
      await vi.advanceTimersByTimeAsync(oracleClientInternals.WORKER_QUEUE_WAIT_MS)
      await rejection
      expect(oracleClientInternals.pendingWorkers()).toBe(0)
    } finally {
      releaseFirst()
      releaseSecond()
      vi.useRealTimers()
    }
    expect(oracleClientInternals.activeWorkers()).toBe(0)
  })
})
