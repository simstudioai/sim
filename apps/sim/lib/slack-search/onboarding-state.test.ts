import { beforeEach, describe, expect, it, vi } from 'vitest'

const redis = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => redis }))

import {
  readSlackSearchOnboardingState,
  storeSlackSearchOnboardingState,
} from '@/lib/slack-search/onboarding-state'

const state = {
  turnId: 'turn1',
  email: 'alice@example.com',
  slackUrl: 'https://sim.slack.com/archives/D1/p100',
  createdAt: Date.now(),
}
beforeEach(() => {
  redis.set.mockResolvedValue('OK')
  redis.get.mockResolvedValue(JSON.stringify(state))
})
describe('Slack account onboarding state', () => {
  it('keeps email and question context out of the URL and uses an expiring hashed lookup', async () => {
    const token = await storeSlackSearchOnboardingState(state)
    const [key, value, mode, ttl, condition] = redis.set.mock.calls[0]
    expect(key).not.toContain(token)
    expect(token).not.toContain(state.email)
    expect(JSON.parse(value)).toEqual(state)
    expect([mode, ttl, condition]).toEqual(['EX', 86400, 'NX'])
  })
  it.each([
    null,
    JSON.stringify({ ...state, createdAt: Date.now() - 86401_000 }),
    JSON.stringify({ ...state, createdAt: Date.now() + 60000 }),
  ])('rejects missing, expired, and future state', async (value) => {
    redis.get.mockResolvedValueOnce(value)
    await expect(readSlackSearchOnboardingState('token')).rejects.toThrow('expired')
  })
})
