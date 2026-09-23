/** @vitest-environment node */
import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeLatestFileIntent,
  type PendingFileIntent,
  peekFileIntent,
  storeFileIntent,
} from '@/lib/mothership/tools/server/files/file-intent-store'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const state = vi.hoisted(() => ({ redis: null as import('ioredis').Redis | null }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => state.redis }))

const socket = process.env.FILE_INTENT_TEST_REDIS_SOCKET
const scope = { chatId: 'chat', messageId: 'message', channelId: 'first' }

/** Opt-in real Redis fixture; never connects to a configured application Redis server. */
describe.skipIf(!socket)('file intent atomic Redis claims', () => {
  let workspaceId: string
  const workspaces: string[] = []

  beforeAll(async () => {
    if (!socket?.startsWith('/tmp/sim-file-intent-') || !socket.endsWith('.sock')) {
      throw new Error('Use a disposable /tmp/sim-file-intent-*.sock Redis socket')
    }
    state.redis = new Redis({ path: socket, maxRetriesPerRequest: 0 })
    await state.redis.ping()
  })
  beforeEach(() => {
    workspaceId = generateId()
    workspaces.push(workspaceId)
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    if (state.redis) {
      for (const id of workspaces) await state.redis.del(`mothership_file_intent:${id}`)
      await state.redis.quit()
      state.redis = null
    }
  })

  function intent(overrides: Partial<PendingFileIntent> = {}): PendingFileIntent {
    return {
      operation: 'update',
      fileId: 'file',
      workspaceId,
      userId: 'user',
      ...scope,
      fileRecord: { id: 'file' } as WorkspaceFileRecord,
      expectedRevision: 'revision',
      createdAt: Date.now(),
      ...overrides,
    }
  }

  async function storeLegacyIntent(prepared: PendingFileIntent): Promise<void> {
    await state.redis!.hset(
      `mothership_file_intent:${workspaceId}`,
      JSON.stringify([prepared.chatId, prepared.messageId, prepared.channelId, prepared.fileId]),
      JSON.stringify(prepared)
    )
  }

  it('claims an intent exactly once across simultaneous consumers', async () => {
    await storeFileIntent(workspaceId, 'file', intent())
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeLatestFileIntent(workspaceId, scope))
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await peekFileIntent(workspaceId, 'file', scope)).toBeUndefined()
  })

  it('retains two channels preparing the same file', async () => {
    await Promise.all(
      ['first', 'second'].map((channelId) =>
        storeFileIntent(workspaceId, 'file', intent({ channelId }))
      )
    )
    const results = await Promise.all(
      ['first', 'second'].map((channelId) =>
        consumeLatestFileIntent(workspaceId, { ...scope, channelId })
      )
    )
    expect(results.map((value) => value?.channelId)).toEqual(['first', 'second'])
  })

  it('does not consume or remove an intent replaced after the read, even in the same millisecond', async () => {
    await storeFileIntent(workspaceId, 'file', intent())
    const prepared = (await peekFileIntent(workspaceId, 'file', scope))!
    const client = state.redis!
    const read = client.hgetall.bind(client)
    const spy = vi.spyOn(client, 'hgetall').mockImplementationOnce(async (key) => {
      const observed = await read(key)
      await storeFileIntent(workspaceId, 'file', prepared)
      return observed
    })
    expect(await consumeLatestFileIntent(workspaceId, scope)).toBeUndefined()
    spy.mockRestore()
    expect(await consumeLatestFileIntent(workspaceId, scope)).toMatchObject({ fileId: 'file' })
  })

  it.each(['identity', 'legacy'] as const)(
    'does not let stale %s preview cleanup remove a newly prepared edit',
    async (format) => {
      const prepared = intent({ createdAt: Date.now() - 3_600_001 })
      if (format === 'legacy') await storeLegacyIntent(prepared)
      else await storeFileIntent(workspaceId, 'file', prepared)
      const client = state.redis!
      const read = client.hget.bind(client)
      const spy = vi.spyOn(client, 'hget').mockImplementationOnce(async (key, field) => {
        const observed = await read(key, field)
        await storeFileIntent(workspaceId, 'file', intent())
        return observed
      })
      expect(await peekFileIntent(workspaceId, 'file', scope)).toBeUndefined()
      spy.mockRestore()
      expect(await consumeLatestFileIntent(workspaceId, scope)).toMatchObject({ fileId: 'file' })
    }
  )

  it.each(['identity', 'legacy'] as const)(
    'claims an 8 MiB %s intent with less than 1 KiB of Redis arguments',
    async (format) => {
      const prepared = intent({ existingContent: 'x'.repeat(8 * 1024 * 1024) })
      if (format === 'legacy') await storeLegacyIntent(prepared)
      else await storeFileIntent(workspaceId, 'file', prepared)
      const spy = vi.spyOn(state.redis!, 'eval')
      expect(await consumeLatestFileIntent(workspaceId, scope)).toMatchObject(prepared)
      expect(spy).toHaveBeenCalledOnce()
      const [, , ...args] = spy.mock.calls[0]!
      expect(args.reduce((bytes, arg) => bytes + Buffer.byteLength(String(arg)), 0)).toBeLessThan(
        1024
      )
      expect(await peekFileIntent(workspaceId, 'file', scope)).toBeUndefined()
      spy.mockRestore()
    }
  )

  it('does not retry a claim when Redis committed it but the response was lost', async () => {
    await storeFileIntent(workspaceId, 'file', intent())
    const client = state.redis!
    const evaluate = client.eval.bind(client)
    const spy = vi.spyOn(client, 'eval').mockImplementationOnce(async (...args) => {
      await evaluate(...args)
      throw new Error('Connection lost after claim')
    })
    await expect(consumeLatestFileIntent(workspaceId, scope)).rejects.toThrow(
      'Connection lost after claim'
    )
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    expect(await consumeLatestFileIntent(workspaceId, scope)).toBeUndefined()
  })
})
