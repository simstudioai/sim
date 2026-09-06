/** @vitest-environment node */
import { createHash } from 'node:crypto'
import { generateShortId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => storage }))

/** The same assertions can exercise the actual Lua against an explicitly supplied disposable socket. */
const redis = process.env.MSHIP_TEST_REDIS_SOCKET
  ? new Redis({
      path: process.env.MSHIP_TEST_REDIS_SOCKET,
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    })
  : undefined
redis?.on('error', () => {})
const recorded = new Map<string, string>()
const memory = {
  eval: vi.fn(
    async (_script: string, _count: number, key: string, value: string, unknown: string) => {
      const previous = recorded.get(key)
      recorded.set(key, previous && previous !== value ? unknown : value)
      return 1
    }
  ),
  get: vi.fn(async (key: string) => recorded.get(key) ?? null),
}
let storage: typeof memory | Redis | null = redis ?? memory
let scope = { workspaceId: 'workspace', userId: 'reader', sessionKey: 'chat' }
const machine = { providerId: 'e2b', sandboxId: 'physical-machine' } as const
const bytes = new Uint8Array([255, 254, 0, 1, 90, 13, 10])
const secret: WorkspaceFileSecretProvenance = {
  status: 'exact',
  entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'reader' }],
}
const safe: WorkspaceFileSecretProvenance = { status: 'exact', entries: [] }
const body = (content = bytes) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(content)
      controller.close()
    },
  })
const consume = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer())

async function download(provenance: WorkspaceFileSecretProvenance = secret) {
  const invocation = createWorkbenchFileProvenance(scope)
  const stream = body()
  invocation.trackDownload(stream, provenance)
  expect(await consume(invocation.observeDownload(machine, stream))).toEqual(bytes)
}

beforeEach(() => {
  vi.clearAllMocks()
  recorded.clear()
  storage = redis ?? memory
  scope = { ...scope, sessionKey: `chat-${generateShortId(16)}` }
})
afterAll(async () => {
  await redis?.quit()
})

describe('trusted workbench byte receipts', () => {
  it('keeps a large safe transfer streamed and readable across invocations', async () => {
    const size = 6 * 1024 * 1024 + 17
    const chunk = new Uint8Array(64 * 1024).fill(255)
    const source = () => {
      let remaining = size
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!remaining) {
            controller.close()
            return
          }
          const length = Math.min(remaining, chunk.length)
          remaining -= length
          controller.enqueue(chunk.subarray(0, length))
        },
      })
    }
    const count = async (stream: ReadableStream<Uint8Array>) => {
      let received = 0
      await stream.pipeTo(
        new WritableStream({
          write(value) {
            received += value.byteLength
          },
        })
      )
      expect(received).toBe(size)
    }
    const first = createWorkbenchFileProvenance(scope)
    const stream = source()
    first.trackDownload(stream, safe)
    await count(first.observeDownload(machine, stream))
    const next = createWorkbenchFileProvenance(scope)
    await count(next.observeUpload(machine, source()))
    expect(next.uploadProvenance()).toEqual(safe)
  })
  it.each([secret, safe, { status: 'unknown' } as const])(
    'survives a fresh invocation: %j',
    async (source) => {
      await download(source)
      const next = createWorkbenchFileProvenance(scope)
      expect(() => next.uploadProvenance()).toThrow('has not finished')
      expect(await consume(next.observeUpload(machine, body()))).toEqual(bytes)
      expect(next.uploadProvenance()).toEqual(source)
    }
  )

  it('classifies changed bytes as unknown without poisoning an unchanged safe copy', async () => {
    await download(safe)
    const changed = createWorkbenchFileProvenance(scope)
    await consume(changed.observeUpload(machine, body(new Uint8Array([0]))))
    expect(changed.uploadProvenance()).toEqual({ status: 'unknown' })
    const unchanged = createWorkbenchFileProvenance(scope)
    await consume(unchanged.observeUpload(machine, body()))
    expect(unchanged.uploadProvenance()).toEqual(safe)
  })

  it.each(['workspaceId', 'userId', 'sessionKey', 'sandboxId', 'providerId'] as const)(
    'isolates evidence by %s',
    async (field) => {
      await download()
      const next = createWorkbenchFileProvenance({
        ...scope,
        ...(['workspaceId', 'userId', 'sessionKey'].includes(field) ? { [field]: 'other' } : {}),
      })
      await consume(
        next.observeUpload(
          {
            ...machine,
            ...(field === 'sandboxId' ? { sandboxId: 'replacement' } : {}),
            ...(field === 'providerId' ? { providerId: 'daytona' as const } : {}),
          },
          body()
        )
      )
      expect(next.uploadProvenance()).toEqual({ status: 'unknown' })
    }
  )

  it('concurrent conflicting receipts cannot overwrite unknown with safe', async () => {
    await Promise.all([download(safe), download({ status: 'unknown' }), download(secret)])
    await download(safe)
    const next = createWorkbenchFileProvenance(scope)
    await consume(next.observeUpload(machine, body()))
    expect(next.uploadProvenance()).toEqual({ status: 'unknown' })
  })

  it('parallel independent streams keep their own classification', async () => {
    const invocation = createWorkbenchFileProvenance(scope)
    const first = body()
    const second = body(new Uint8Array([1]))
    invocation.trackDownload(first, secret)
    invocation.trackDownload(second, safe)
    await Promise.all([
      consume(invocation.observeDownload(machine, first)),
      consume(invocation.observeDownload(machine, second)),
    ])
    const next = createWorkbenchFileProvenance(scope)
    await consume(next.observeUpload(machine, body()))
    expect(next.uploadProvenance()).toEqual(secret)
    const other = createWorkbenchFileProvenance(scope)
    await consume(other.observeUpload(machine, body(new Uint8Array([1]))))
    expect(other.uploadProvenance()).toEqual(safe)
  })

  it('cannot complete from a partially consumed or failed stream', async () => {
    const invocation = createWorkbenchFileProvenance(scope)
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
      },
      pull(controller) {
        controller.error(new Error('transfer failed'))
      },
    })
    await expect(consume(invocation.observeUpload(machine, failing))).rejects.toThrow(
      'transfer failed'
    )
    expect(() => invocation.uploadProvenance()).toThrow('has not finished')
  })

  it('Stop makes even a fully read source unavailable for completion', async () => {
    await download()
    const controller = new AbortController()
    const invocation = createWorkbenchFileProvenance({ ...scope, signal: controller.signal })
    await consume(invocation.observeUpload(machine, body()))
    controller.abort(new Error('stopped'))
    expect(() => invocation.uploadProvenance()).toThrow('stopped')
  })

  it('missing, malformed and unavailable storage never certifies bytes safe', async () => {
    const next = createWorkbenchFileProvenance(scope)
    await consume(next.observeUpload(machine, body()))
    expect(next.uploadProvenance()).toEqual({ status: 'unknown' })
    const namespace = createHash('sha256')
      .update(
        JSON.stringify([
          scope.workspaceId,
          scope.userId,
          scope.sessionKey,
          machine.providerId,
          machine.sandboxId,
        ])
      )
      .digest('hex')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const key = `mothership:file-source:v1:${namespace}:${digest}`
    if (redis) await redis.set(key, 'broken JSON', 'EX', 60)
    else recorded.set(key, 'broken JSON')
    const broken = createWorkbenchFileProvenance(scope)
    await consume(broken.observeUpload(machine, body()))
    expect(broken.uploadProvenance()).toEqual({ status: 'unknown' })
    storage = null
    const unavailable = createWorkbenchFileProvenance(scope)
    await expect(consume(unavailable.observeUpload(machine, body()))).rejects.toThrow(
      'storage is unavailable'
    )
    expect(() => unavailable.uploadProvenance()).toThrow('has not finished')
  })
})
