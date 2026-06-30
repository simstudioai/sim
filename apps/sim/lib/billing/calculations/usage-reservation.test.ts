/**
 * @vitest-environment node
 */
import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFlags } = vi.hoisted(() => ({
  mockFlags: { isBillingEnabled: true },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
  isHosted: true,
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

import {
  releaseExecutionSlot,
  reserveExecutionSlot,
  resolveBillingEntityKey,
} from '@/lib/billing/calculations/usage-reservation'

const evalMock = vi.fn()
const getdelMock = vi.fn()
const zremMock = vi.fn()
const fakeRedis = { eval: evalMock, getdel: getdelMock, zrem: zremMock }

const baseParams = {
  userId: 'user-1',
  executionId: 'exec-1',
  subscription: { plan: 'free' as const, referenceId: 'user-1' },
  currentUsage: 0,
  limit: 5,
}

describe('usage-reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isBillingEnabled = true
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(fakeRedis)
  })

  describe('resolveBillingEntityKey', () => {
    it('keys personal subscriptions by user', () => {
      expect(resolveBillingEntityKey('user-1', { referenceId: 'user-1' })).toBe('user:user-1')
    })

    it('keys org-scoped subscriptions by organization', () => {
      expect(resolveBillingEntityKey('user-1', { referenceId: 'org-9' })).toBe('org:org-9')
    })
  })

  describe('reserveExecutionSlot', () => {
    it('admits when the reservation script returns 1', async () => {
      evalMock.mockResolvedValueOnce(1)
      const result = await reserveExecutionSlot(baseParams)
      expect(result.reserved).toBe(true)
      expect(evalMock).toHaveBeenCalledTimes(1)
    })

    it('rejects when the reservation script returns 0 (slots full)', async () => {
      evalMock.mockResolvedValueOnce(0)
      const result = await reserveExecutionSlot(baseParams)
      expect(result.reserved).toBe(false)
    })

    it('passes the free-tier concurrency cap and headroom slots to the script', async () => {
      evalMock.mockResolvedValueOnce(1)
      await reserveExecutionSlot(baseParams)
      const args = evalMock.mock.calls[0]
      // eval(script, numKeys, inflightKey, pointerKey, now, expiry, maxConc, headroomSlots, member, entityKey, pttl)
      expect(args[2]).toBe('usage:inflight:user:user-1')
      expect(args[3]).toBe('usage:reservation:exec-1')
      expect(args[6]).toBe('15')
      expect(args[7]).toBe('1000')
      expect(args[8]).toBe('exec-1')
      expect(args[9]).toBe('user:user-1')
    })

    it('reserves against the org entity for org-scoped subscriptions', async () => {
      evalMock.mockResolvedValueOnce(1)
      await reserveExecutionSlot({
        ...baseParams,
        subscription: { plan: 'team', referenceId: 'org-9' },
      })
      const args = evalMock.mock.calls[0]
      expect(args[2]).toBe('usage:inflight:org:org-9')
      expect(args[6]).toBe('150')
    })

    it('clamps negative headroom to zero slots', async () => {
      evalMock.mockResolvedValueOnce(0)
      await reserveExecutionSlot({ ...baseParams, currentUsage: 10, limit: 5 })
      expect(evalMock.mock.calls[0][7]).toBe('0')
    })

    it('fails open (admits) when billing enforcement is disabled', async () => {
      mockFlags.isBillingEnabled = false
      const result = await reserveExecutionSlot(baseParams)
      expect(result.reserved).toBe(true)
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('fails open (admits) when Redis is unavailable', async () => {
      redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
      const result = await reserveExecutionSlot(baseParams)
      expect(result.reserved).toBe(true)
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('fails open (admits) when the reservation script throws', async () => {
      evalMock.mockRejectedValueOnce(new Error('connection lost'))
      const result = await reserveExecutionSlot(baseParams)
      expect(result.reserved).toBe(true)
    })
  })

  describe('releaseExecutionSlot', () => {
    it('reads the pointer then removes the slot from that entity set', async () => {
      getdelMock.mockResolvedValueOnce('org:org-9')
      await releaseExecutionSlot('exec-1')
      expect(getdelMock).toHaveBeenCalledWith('usage:reservation:exec-1')
      expect(zremMock).toHaveBeenCalledWith('usage:inflight:org:org-9', 'exec-1')
    })

    it('does not touch the in-flight set when the pointer is already gone', async () => {
      getdelMock.mockResolvedValueOnce(null)
      await releaseExecutionSlot('exec-1')
      expect(zremMock).not.toHaveBeenCalled()
    })

    it('uses only single-key commands (cluster-safe; no key built inside Lua)', async () => {
      getdelMock.mockResolvedValueOnce('user:user-1')
      await releaseExecutionSlot('exec-1')
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('is a no-op when billing enforcement is disabled', async () => {
      mockFlags.isBillingEnabled = false
      await releaseExecutionSlot('exec-1')
      expect(getdelMock).not.toHaveBeenCalled()
    })

    it('swallows release errors', async () => {
      getdelMock.mockRejectedValueOnce(new Error('boom'))
      await expect(releaseExecutionSlot('exec-1')).resolves.toBeUndefined()
    })
  })
})
