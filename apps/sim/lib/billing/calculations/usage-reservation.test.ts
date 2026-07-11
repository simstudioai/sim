/**
 * @vitest-environment node
 */
import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFlags } = vi.hoisted(() => ({
  mockFlags: { isBillingEnabled: true, isHosted: true },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
  get isHosted() {
    return mockFlags.isHosted
  },
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

import {
  releaseExecutionSlot,
  reserveExecutionSlot,
  resolveBillingEntityKey,
  UsageReservationUnavailableError,
} from '@/lib/billing/calculations/usage-reservation'

const evalMock = vi.fn()
const getMock = vi.fn()
const fakeRedis = { eval: evalMock, get: getMock }

const baseParams = {
  billingEntity: { type: 'user' as const, id: 'user-1' },
  reservationId: 'exec-1',
  plan: 'free' as const,
  currentUsage: 0,
  limit: 5,
}

const memberParams = {
  ...baseParams,
  billingEntity: { type: 'organization' as const, id: 'org-1' },
  plan: 'team' as const,
  member: {
    organizationId: 'org-1',
    actorUserId: 'user-1',
    currentUsage: 0,
    limit: 0.005,
  },
}

function hashTag(key: string): string | undefined {
  return key.match(/\{([^}]+)\}/)?.[1]
}

describe('usage-reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isBillingEnabled = true
    mockFlags.isHosted = true
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(fakeRedis)
  })

  describe('resolveBillingEntityKey', () => {
    it('keys personal subscriptions by user', () => {
      expect(resolveBillingEntityKey({ type: 'user', id: 'user-1' })).toBe('user:user-1')
    })

    it('keys org-scoped subscriptions by organization', () => {
      expect(resolveBillingEntityKey({ type: 'organization', id: 'org-9' })).toBe('org:org-9')
    })
  })

  describe('reserveExecutionSlot', () => {
    it('admits only after the atomic reservation and pointer registration succeed', async () => {
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)
      const result = await reserveExecutionSlot(baseParams)
      expect(result).toEqual({ reserved: true, created: true })
      expect(evalMock).toHaveBeenCalledTimes(2)
    })

    it('returns payer exhaustion without registering a pointer', async () => {
      evalMock.mockResolvedValueOnce(2)
      const result = await reserveExecutionSlot(baseParams)
      expect(result).toEqual({ reserved: false, reason: 'payer_concurrency' })
      expect(evalMock).toHaveBeenCalledTimes(1)
    })

    it('returns payer base-charge headroom exhaustion without registering a pointer', async () => {
      evalMock.mockResolvedValueOnce(3)
      const result = await reserveExecutionSlot({
        ...baseParams,
        currentUsage: 4.999,
      })
      expect(result).toEqual({ reserved: false, reason: 'payer_headroom' })
      expect(evalMock).toHaveBeenCalledTimes(1)
      expect(evalMock.mock.calls[0][7]).toBe('0')
      expect(evalMock.mock.calls[0][0]).not.toContain('payerBaseChargeSlots < 1')
    })

    it('returns member exhaustion from the same atomic reservation operation', async () => {
      evalMock.mockResolvedValueOnce(4)
      const result = await reserveExecutionSlot(memberParams)
      expect(result).toEqual({ reserved: false, reason: 'member_headroom' })
      expect(evalMock).toHaveBeenCalledTimes(1)
      expect(evalMock.mock.calls[0][0]).not.toContain('memberBaseChargeSlots < 1')
    })

    it('keeps duplicate execution ids idempotent', async () => {
      evalMock.mockResolvedValueOnce(5).mockResolvedValueOnce(2)
      const result = await reserveExecutionSlot(baseParams)
      expect(result).toEqual({ reserved: true, created: false })
      expect(evalMock.mock.calls[0][0]).toMatch(
        /redis\.call\('PEXPIREAT', KEYS\[2\], expiryAt\)\s+return 5/
      )
      expect(evalMock.mock.calls[0][0]).toContain(
        "local payerReservation = redis.call('ZSCORE', KEYS[1], ARGV[5])"
      )
    })

    it('uses a resume entry reservation id independently from the parent execution id', async () => {
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)

      await reserveExecutionSlot({
        ...baseParams,
        reservationId: 'resume-entry-1',
      })

      expect(evalMock.mock.calls[0][8]).toBe('resume-entry-1')
      expect(evalMock.mock.calls[1][2]).toBe('usage:reservation:resume-entry-1')
    })

    it('passes the free-tier concurrency cap and payer headroom to the atomic script', async () => {
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)
      await reserveExecutionSlot(baseParams)
      const args = evalMock.mock.calls[0]
      expect(args[1]).toBe(2)
      expect(args[2]).toContain('{user:user-1}')
      expect(args[3]).toContain('{user:user-1}')
      expect(args[6]).toBe('15')
      expect(args[7]).toBe('1000')
      expect(args[8]).toBe('exec-1')
    })

    it('atomically declares payer, owner, and member keys in one cluster slot', async () => {
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)
      await reserveExecutionSlot(memberParams)
      const args = evalMock.mock.calls[0]
      expect(args[1]).toBe(3)
      const declaredKeys = args.slice(2, 5) as string[]
      expect(new Set(declaredKeys.map(hashTag))).toEqual(new Set(['org:org-1']))
      expect(args[7]).toBe('150')
      expect(args.at(-1)).toBe('1')
      expect(args[0]).not.toContain('usage:')
    })

    it('caps enterprise payer work at 300 entries without Lua enumeration', async () => {
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)

      await reserveExecutionSlot({ ...baseParams, plan: 'enterprise' })

      const args = evalMock.mock.calls[0]
      expect(args[6]).toBe('300')
      expect(args[0]).toContain("redis.call('ZREMRANGEBYSCORE'")
      expect(args[0]).not.toMatch(/ZRANGE|SMEMBERS|HGETALL|KEYS\s/)
    })

    it('clamps negative headroom to zero slots', async () => {
      evalMock.mockResolvedValueOnce(3)
      await reserveExecutionSlot({ ...baseParams, currentUsage: 10, limit: 5 })
      expect(evalMock.mock.calls[0][7]).toBe('0')
    })

    it('atomically rejects a member when payer capacity remains', async () => {
      evalMock.mockResolvedValueOnce(4)
      const result = await reserveExecutionSlot(memberParams)
      expect(result).toEqual({ reserved: false, reason: 'member_headroom' })
      expect(evalMock.mock.calls[0][1]).toBe(3)
    })

    it('admits only one concurrent execution against one member headroom slot', async () => {
      const members = new Set<string>()
      evalMock.mockImplementation(
        async (_script: string, keyCount: number, ...args: Array<string | number>) => {
          const keys = args.slice(0, keyCount) as string[]
          if (keys[0].startsWith('usage:reservation:')) return 1
          const executionId = String(args[keyCount + 4])
          if (members.has(executionId)) return 5
          if (members.size >= 1) return 4
          members.add(executionId)
          return 1
        }
      )

      const results = await Promise.all([
        reserveExecutionSlot({ ...memberParams, reservationId: 'exec-1' }),
        reserveExecutionSlot({ ...memberParams, reservationId: 'exec-2' }),
      ])

      expect(results).toContainEqual({ reserved: true, created: true })
      expect(results).toContainEqual({ reserved: false, reason: 'member_headroom' })
    })

    it('admits concurrent duplicate calls as one reservation', async () => {
      const members = new Set<string>()
      evalMock.mockImplementation(
        async (_script: string, keyCount: number, ...args: Array<string | number>) => {
          const keys = args.slice(0, keyCount) as string[]
          if (keys[0].startsWith('usage:reservation:')) return members.size === 1 ? 2 : 1
          const executionId = String(args[keyCount + 4])
          if (members.has(executionId)) return 5
          members.add(executionId)
          return 1
        }
      )

      const results = await Promise.all([
        reserveExecutionSlot(memberParams),
        reserveExecutionSlot(memberParams),
      ])

      expect(results).toEqual([
        { reserved: true, created: true },
        { reserved: true, created: false },
      ])
      expect(members).toEqual(new Set(['exec-1']))
    })

    it('is a no-op when billing enforcement is disabled', async () => {
      mockFlags.isBillingEnabled = false
      const result = await reserveExecutionSlot(baseParams)
      expect(result.reserved).toBe(true)
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('is a no-op on self-hosted deployments', async () => {
      mockFlags.isHosted = false
      const result = await reserveExecutionSlot(baseParams)
      expect(result).toEqual({ reserved: true, created: false })
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('fails closed when hosted Redis is unavailable', async () => {
      redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
      await expect(reserveExecutionSlot(baseParams)).rejects.toBeInstanceOf(
        UsageReservationUnavailableError
      )
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('fails closed when the atomic reservation result is unknown', async () => {
      evalMock.mockRejectedValueOnce(new Error('connection lost'))
      await expect(reserveExecutionSlot(baseParams)).rejects.toMatchObject({
        statusCode: 503,
        retryable: true,
      })
    })

    it('admits when a pointer write succeeded despite a lost response', async () => {
      evalMock.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('pointer response lost'))
      getMock.mockImplementationOnce(async () => String(evalMock.mock.calls[1]?.[3]))

      await expect(reserveExecutionSlot(memberParams)).resolves.toEqual({
        reserved: true,
        created: true,
      })

      expect(evalMock).toHaveBeenCalledTimes(2)
      expect(getMock).toHaveBeenCalledWith('usage:reservation:exec-1')
    })

    it('rolls back a newly-created atomic reservation when pointer registration fails', async () => {
      evalMock
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('pointer write failed'))
        .mockResolvedValueOnce(1)
      getMock.mockResolvedValueOnce(null)

      await expect(reserveExecutionSlot(memberParams)).rejects.toBeInstanceOf(
        UsageReservationUnavailableError
      )

      expect(evalMock).toHaveBeenCalledTimes(3)
      const rollback = evalMock.mock.calls[2]
      expect(rollback[1]).toBe(3)
      expect(new Set((rollback.slice(2, 5) as string[]).map(hashTag))).toEqual(
        new Set(['org:org-1'])
      )
      expect(rollback[0]).not.toContain('usage:')
    })

    it('still fails closed when rollback cannot be proven', async () => {
      evalMock
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('pointer write failed'))
        .mockRejectedValueOnce(new Error('rollback unavailable'))
      getMock.mockResolvedValueOnce(null)

      await expect(reserveExecutionSlot(memberParams)).rejects.toMatchObject({
        statusCode: 503,
        retryable: true,
      })
    })

    it('does not risk rollback when pointer state cannot be read', async () => {
      evalMock.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('pointer write failed'))
      getMock.mockRejectedValueOnce(new Error('pointer read unavailable'))

      await expect(reserveExecutionSlot(memberParams)).rejects.toMatchObject({
        statusCode: 503,
        retryable: true,
      })

      expect(evalMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('releaseExecutionSlot', () => {
    async function createDescriptor(reservationId = 'exec-1'): Promise<string> {
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)
      await reserveExecutionSlot({ ...memberParams, reservationId })
      return String(evalMock.mock.calls[1][3])
    }

    it('deletes the pointer before atomically removing payer and member constraints', async () => {
      const descriptor = await createDescriptor()
      vi.clearAllMocks()
      getMock.mockResolvedValueOnce(descriptor)
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)

      await releaseExecutionSlot('exec-1')

      expect(getMock).toHaveBeenCalledWith('usage:reservation:exec-1')
      expect(evalMock.mock.calls[0][1]).toBe(1)
      expect(evalMock.mock.calls[0][2]).toBe('usage:reservation:exec-1')
      const localRelease = evalMock.mock.calls[1]
      expect(localRelease[1]).toBe(3)
      expect(new Set((localRelease.slice(2, 5) as string[]).map(hashTag))).toEqual(
        new Set(['org:org-1'])
      )
      expect(localRelease[0]).not.toContain('usage:')
    })

    it('keeps a stale attempt release isolated from a newer attempt reservation', async () => {
      const descriptor = await createDescriptor('resume-entry-old')
      vi.clearAllMocks()
      getMock.mockResolvedValueOnce(descriptor)
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)

      await releaseExecutionSlot('resume-entry-old')

      expect(getMock).toHaveBeenCalledWith('usage:reservation:resume-entry-old')
      const localRelease = evalMock.mock.calls[1]
      expect(localRelease[3]).toContain('resume-entry-old')
      expect(localRelease.at(-2)).toBe('resume-entry-old')
      expect(JSON.stringify(evalMock.mock.calls)).not.toContain('resume-entry-new')
    })

    it('removes the retained slot exactly once across repeated releases', async () => {
      const descriptor = await createDescriptor()
      vi.clearAllMocks()
      getMock.mockResolvedValueOnce(descriptor).mockResolvedValueOnce(null)
      evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1)

      await releaseExecutionSlot('exec-1')
      await releaseExecutionSlot('exec-1')

      expect(getMock).toHaveBeenCalledTimes(2)
      expect(evalMock).toHaveBeenCalledTimes(2)
    })

    it('does not touch local constraints when the pointer is already gone', async () => {
      getMock.mockResolvedValueOnce(null)
      await releaseExecutionSlot('exec-1')
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('retains bounded local constraints when pointer deletion cannot be proven', async () => {
      const descriptor = await createDescriptor()
      vi.clearAllMocks()
      getMock.mockResolvedValueOnce(descriptor).mockResolvedValueOnce(descriptor)
      evalMock.mockRejectedValueOnce(new Error('pointer delete unavailable'))

      await releaseExecutionSlot('exec-1')

      expect(evalMock).toHaveBeenCalledTimes(1)
    })

    it('removes local constraints when a lost delete response is proven successful', async () => {
      const descriptor = await createDescriptor()
      vi.clearAllMocks()
      getMock.mockResolvedValueOnce(descriptor).mockResolvedValueOnce(null)
      evalMock
        .mockRejectedValueOnce(new Error('pointer delete response lost'))
        .mockResolvedValueOnce(1)

      await releaseExecutionSlot('exec-1')

      expect(evalMock).toHaveBeenCalledTimes(2)
      expect(evalMock.mock.calls[1][1]).toBe(3)
    })

    it('is a no-op when billing enforcement is disabled', async () => {
      mockFlags.isBillingEnabled = false
      await releaseExecutionSlot('exec-1')
      expect(getMock).not.toHaveBeenCalled()
    })

    it('swallows release errors', async () => {
      getMock.mockRejectedValueOnce(new Error('boom'))
      await expect(releaseExecutionSlot('exec-1')).resolves.toBeUndefined()
    })
  })
})
