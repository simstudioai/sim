import { createMockRedis } from '@sim/testing/mocks/redis.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  initializeSessionFileProvenance,
  readSessionSecretProvenance,
  recordSessionFileInput,
} from '@/lib/execution/remote-sandbox/session-file-provenance'

const machine = { providerId: 'e2b', sandboxId: 'machine' } as const

beforeEach(() => {
  const redis = createMockRedis()
  const failure = new Error('Connection is closed.')
  redis.set.mockRejectedValue(failure)
  redis.eval.mockRejectedValue(failure)
  redis.get.mockRejectedValue(failure)
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
})

describe('failing workbench evidence storage', () => {
  it('refuses allocation, input receipt and output classification when Redis fails', async () => {
    await expect(initializeSessionFileProvenance('chat', machine)).rejects.toThrow(
      'Connection is closed.'
    )
    await expect(recordSessionFileInput('chat', machine, true)).rejects.toThrow(
      'Connection is closed.'
    )
    await expect(readSessionSecretProvenance('chat', machine)).rejects.toThrow(
      'Connection is closed.'
    )
  })
})
