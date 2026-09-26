import { createHash } from 'node:crypto'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { generateShortId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const records = new Map<string, string>()
const memory = {
  set: async (key: string, value: string) => {
    if (!records.has(key)) records.set(key, value)
  },
  get: async (key: string) => records.get(key) ?? null,
  eval: async (_script: string, _count: number, key: string, input: string) => {
    records.set(key, records.get(key) === 'clean' && input === 'clean' ? 'clean' : 'unknown')
  },
}
const redis = process.env.MSHIP_TEST_REDIS_SOCKET
  ? new Redis({
      path: process.env.MSHIP_TEST_REDIS_SOCKET,
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    })
  : undefined
redis?.on('error', () => {})
let storage: typeof memory | Redis | null = redis ?? memory
redisConfigMockFns.mockGetRedisClient.mockImplementation(() => storage)

import {
  initializeSessionFileProvenance,
  isSessionFileProvenanceClean,
  recordSessionFileInput,
} from '@/lib/execution/remote-sandbox/session-file-provenance'

let session = ''
const ownedKeys = new Set<string>()
const machine = { providerId: 'e2b', sandboxId: 'machine' } as const
beforeEach(() => {
  records.clear()
  storage = redis ?? memory
  session = `scratch-test-${generateShortId(16)}`
  for (const [scope, provider, id] of [
    [session, 'e2b', 'machine'],
    [`${session}-other`, 'e2b', 'machine'],
    [session, 'e2b', 'replacement'],
    [session, 'modal', 'machine'],
  ])
    ownedKeys.add(
      `mothership:workbench-provenance:v1:${createHash('sha256')
        .update(JSON.stringify([scope, provider, id]))
        .digest('hex')}`
    )
})
afterAll(async () => {
  if (redis) {
    const keys = [...ownedKeys]
    if (keys.length) await redis.del(...keys)
    redis.disconnect()
  }
})

describe('physical session input history', () => {
  it('permits fresh safe code, but a prior secret stays unknown through retries and a clean later call', async () => {
    await initializeSessionFileProvenance(session, machine)
    await recordSessionFileInput(session, machine, true)
    expect(await isSessionFileProvenanceClean(session, machine)).toBe(true)
    await recordSessionFileInput(session, machine, false)
    await recordSessionFileInput(session, machine, true)
    await initializeSessionFileProvenance(session, machine)
    expect(await isSessionFileProvenanceClean(session, machine)).toBe(false)
  })
  it('never certifies a recovered machine with absent history from a current clean input', async () => {
    expect(await isSessionFileProvenanceClean(session, machine)).toBe(false)
    await recordSessionFileInput(session, machine, true)
    expect(await isSessionFileProvenanceClean(session, machine)).toBe(false)
  })
  it('binds evidence to exact chat, provider and physical machine rather than a reused path', async () => {
    await initializeSessionFileProvenance(session, machine)
    expect(await isSessionFileProvenanceClean(`${session}-other`, machine)).toBe(false)
    expect(
      await isSessionFileProvenanceClean(session, { ...machine, sandboxId: 'replacement' })
    ).toBe(false)
    expect(await isSessionFileProvenanceClean(session, { ...machine, providerId: 'modal' })).toBe(
      false
    )
    await initializeSessionFileProvenance(session, { ...machine, sandboxId: 'replacement' })
    expect(
      await isSessionFileProvenanceClean(session, { ...machine, sandboxId: 'replacement' })
    ).toBe(true)
  })
  it('fails closed when evidence storage or physical identity is absent', async () => {
    storage = null
    await expect(isSessionFileProvenanceClean(session, machine)).rejects.toThrow(
      'storage is unavailable'
    )
    storage = redis ?? memory
    await expect(initializeSessionFileProvenance(session, { providerId: 'e2b' })).rejects.toThrow(
      'physical identity'
    )
  })
})
