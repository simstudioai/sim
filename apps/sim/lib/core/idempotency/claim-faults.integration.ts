/**
 * The Redis claim under a lost or late reply, against real Redis. A TCP proxy between ioredis and
 * Redis lets the claim script run and then drops the connection before its reply (ioredis replays
 * the command on reconnect) or holds the reply past the command timeout. Skipped without
 * `TEST_REDIS_URL`; the Redis client accessor is the only fixture.
 */
import { createServer, type Server, type Socket, connect as tcpConnect } from 'node:net'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import { IdempotencyService } from '@/lib/core/idempotency/service'

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

const redisUrl = readTestRedisUrl()
const COMMAND_TIMEOUT_MS = 500
const CLAIM_SCRIPT_MARKER = 'local claimed'

type ClaimFault = { kind: 'drop-reply' } | { kind: 'delay-reply'; ms: number }

/** Forwards bytes both ways; applies one armed fault to the next reply after a claim script. */
class ClaimFaultProxy {
  private server: Server | undefined
  private armed: ClaimFault | undefined
  claimsForwarded = 0

  async start(upstream: URL): Promise<number> {
    this.server = createServer((client) => this.pipe(client, upstream))
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('proxy has no port')
    return address.port
  }

  arm(fault: ClaimFault): void {
    this.armed = fault
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve))
  }

  private pipe(client: Socket, upstream: URL): void {
    const server = tcpConnect(Number(upstream.port || 6379), upstream.hostname)
    let pendingFault: ClaimFault | undefined
    // Keeps the stream's tail so a marker that TCP split across chunks still matches.
    let tail = ''
    client.on('data', (chunk) => {
      const seen = tail + chunk.toString('latin1')
      tail = seen.slice(-(CLAIM_SCRIPT_MARKER.length - 1))
      if (seen.includes(CLAIM_SCRIPT_MARKER)) {
        this.claimsForwarded++
        if (this.armed) {
          pendingFault = this.armed
          this.armed = undefined
        }
      }
      server.write(chunk)
    })
    server.on('data', (chunk) => {
      const fault = pendingFault
      pendingFault = undefined
      if (fault?.kind === 'drop-reply') {
        client.destroy()
        server.destroy()
        return
      }
      if (fault?.kind === 'delay-reply') {
        server.pause()
        setTimeout(() => {
          if (!client.destroyed) client.write(chunk)
          server.resume()
        }, fault.ms)
        return
      }
      if (!client.destroyed) client.write(chunk)
    })
    client.on('close', () => server.destroy())
    server.on('close', () => client.destroy())
    client.on('error', () => server.destroy())
    server.on('error', () => client.destroy())
  }
}

describe.runIf(Boolean(redisUrl))('Redis idempotency claim with a lost or late reply', () => {
  const proxy = new ClaimFaultProxy()
  let redis: Redis
  let direct: Redis
  const namespace = `claim-faults-${generateId()}`
  const service = new IdempotencyService({
    namespace,
    inProgressTtlSeconds: 60 * 60 * 2,
    storeResultBody: false,
    forceStorage: 'redis',
  })

  beforeAll(async () => {
    const upstream = new URL(redisUrl ?? '')
    const port = await proxy.start(upstream)
    redis = new Redis({
      host: '127.0.0.1',
      port,
      db: Number(upstream.pathname.slice(1) || 0),
      lazyConnect: true,
      commandTimeout: COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 5,
      retryStrategy: () => 50,
    })
    await redis.connect()
    direct = new Redis(redisUrl ?? '', { lazyConnect: true, maxRetriesPerRequest: 0 })
    await direct.connect()
  })

  beforeEach(() => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  })

  afterAll(async () => {
    redis?.disconnect()
    const keys = (await direct?.keys(`idempotency:${namespace}:*`)) ?? []
    if (keys.length > 0) await direct.del(...keys)
    await direct?.quit()
    await proxy.stop()
  })

  async function storedStatus(identifier: string): Promise<string | undefined> {
    const keys = await direct.keys(`idempotency:*:${identifier}`)
    if (keys.length === 0) return undefined
    const value = await direct.get(keys[0])
    return value ? (JSON.parse(value) as { status?: string }).status : undefined
  }

  it('runs the operation once when the claim applied but its reply was lost', async () => {
    const identifier = generateId()
    const operation = vi.fn(async () => 'ran')
    const claimsBefore = proxy.claimsForwarded

    proxy.arm({ kind: 'drop-reply' })
    const execution = await service.executeOrSkipInProgress('generic', identifier, operation)

    expect(proxy.claimsForwarded - claimsBefore).toBe(2)
    expect(execution).toEqual({ outcome: 'resolved', result: 'ran' })
    expect(operation).toHaveBeenCalledTimes(1)
    expect(await storedStatus(identifier)).toBe('completed')
  })

  it('releases its claim and asks for a retry when the claim reply is late, so a retry runs', async () => {
    const identifier = generateId()
    const operation = vi.fn(async () => 'ran')

    proxy.arm({ kind: 'delay-reply', ms: COMMAND_TIMEOUT_MS * 1.5 })
    const failure = await service.executeOrSkipInProgress('generic', identifier, operation).then(
      () => undefined,
      (error: unknown) => error
    )
    await sleep(COMMAND_TIMEOUT_MS * 2)

    expect(isRetryableSetupError(failure)).toBe(true)
    expect(operation).not.toHaveBeenCalled()
    expect(await storedStatus(identifier)).toBeUndefined()

    const retry = await service.executeOrSkipInProgress('generic', identifier, operation)
    expect(retry).toEqual({ outcome: 'resolved', result: 'ran' })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('keeps the original error when the stall also outlasts the release', async () => {
    const identifier = generateId()
    const operation = vi.fn(async () => 'ran')

    proxy.arm({ kind: 'delay-reply', ms: COMMAND_TIMEOUT_MS * 3 })
    const failure = await service.executeOrSkipInProgress('generic', identifier, operation).then(
      () => undefined,
      (error: unknown) => error
    )
    await sleep(COMMAND_TIMEOUT_MS * 4)

    expect(failure).toBeInstanceOf(Error)
    expect(isRetryableSetupError(failure)).toBe(false)
    expect(operation).not.toHaveBeenCalled()
  })

  it("still skips a delivery whose key is another holder's live claim", async () => {
    const identifier = generateId()
    let holderStarted!: () => void
    const started = new Promise<void>((resolve) => {
      holderStarted = resolve
    })
    let releaseHolder!: () => void
    const released = new Promise<void>((resolve) => {
      releaseHolder = resolve
    })
    const holder = vi.fn(async () => {
      holderStarted()
      await released
      return 'holder'
    })
    const duplicate = vi.fn(async () => 'duplicate')

    const running = service.executeOrSkipInProgress('generic', identifier, holder)
    await started
    const second = await service.executeOrSkipInProgress('generic', identifier, duplicate)
    releaseHolder()

    expect(second).toEqual({ outcome: 'in-progress' })
    expect(duplicate).not.toHaveBeenCalled()
    expect(await running).toEqual({ outcome: 'resolved', result: 'holder' })
  })
})
