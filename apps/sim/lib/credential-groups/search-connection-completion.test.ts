/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    values,
    redis: {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        if (values.has(key)) return null
        values.set(key, value)
        return 'OK'
      }),
    },
  }
})
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => m.redis }))

import {
  readSearchConnectionCompletion,
  recordSearchConnectionCompletion,
} from '@/lib/credential-groups/search-connection-completion'

const scope = { userId: 'person', organizationId: 'org', completionId: 'attempt' }
beforeEach(() => {
  vi.clearAllMocks()
  m.values.clear()
})
describe('Search OAuth completion receipts', () => {
  it('isolates people, organizations and concurrent attempts', async () => {
    await recordSearchConnectionCompletion({ ...scope, credentialId: 'mine' })
    expect(await readSearchConnectionCompletion(scope)).toBe('mine')
    expect(await readSearchConnectionCompletion({ ...scope, userId: 'someone-else' })).toBeNull()
    expect(await readSearchConnectionCompletion({ ...scope, organizationId: 'another' })).toBeNull()
    expect(
      await readSearchConnectionCompletion({ ...scope, completionId: 'other-attempt' })
    ).toBeNull()
    expect(m.redis.set).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ credentialId: 'mine' }),
      'EX',
      86_400,
      'NX'
    )
  })
  it('does not allow a completion to be overwritten', async () => {
    await recordSearchConnectionCompletion({ ...scope, credentialId: 'mine' })
    await expect(
      recordSearchConnectionCompletion({ ...scope, credentialId: 'changed' })
    ).rejects.toThrow('already recorded')
    expect(await readSearchConnectionCompletion(scope)).toBe('mine')
  })
})
