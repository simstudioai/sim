import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  initializeSessionFileProvenance,
  readSessionSecretProvenance,
  recordSessionFileInput,
} from '@/lib/execution/remote-sandbox/session-file-provenance'

const machine = { providerId: 'e2b', sandboxId: 'machine' } as const
beforeEach(() => redisConfigMockFns.mockGetRedisClient.mockReturnValue(null))

describe('unavailable workbench evidence storage', () => {
  it('refuses allocation, input receipt and output classification when Redis is unavailable', async () => {
    await expect(initializeSessionFileProvenance('chat', machine)).rejects.toThrow(
      'storage is unavailable'
    )
    await expect(recordSessionFileInput('chat', machine, true)).rejects.toThrow(
      'storage is unavailable'
    )
    await expect(readSessionSecretProvenance('chat', machine)).rejects.toThrow(
      'storage is unavailable'
    )
  })
})
