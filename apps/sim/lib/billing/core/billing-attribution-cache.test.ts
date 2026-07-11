/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEval, mockMget, mockRedisState } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockMget: vi.fn(),
  mockRedisState: { available: true },
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: () =>
    mockRedisState.available
      ? {
          eval: mockEval,
          mget: mockMget,
        }
      : null,
}))

import {
  cacheBillingAttribution,
  getCachedBillingAttribution,
} from '@/lib/billing/core/billing-attribution-cache'

const ATTRIBUTION = {
  actorUserId: 'actor-a',
  billedAccountUserId: 'owner-b',
  billingEntity: { type: 'organization' as const, id: 'org-b' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  organizationId: 'org-b',
  payerSubscription: null,
  workspaceId: 'workspace-b',
}

describe('billing attribution cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisState.available = true
    mockEval.mockResolvedValue(1)
    mockMget.mockResolvedValue([null])
  })

  it('atomically stores one legacy immutable snapshot alias', async () => {
    await expect(cacheBillingAttribution('billing-request-1', ATTRIBUTION)).resolves.toBe(true)

    expect(mockEval).toHaveBeenCalledTimes(1)
    const call = mockEval.mock.calls[0]
    const keyCount = call[1] as number
    const args = call.slice(2 + keyCount)
    expect(keyCount).toBe(1)
    expect(JSON.parse(args[0])).toEqual(ATTRIBUTION)
    expect(args.slice(1)).toEqual(['604800', '0', ''])
  })

  it('preserves legacy aliases atomically before the protocol cutover', async () => {
    mockMget.mockResolvedValue([null, null])

    await expect(
      cacheBillingAttribution(['message-1', 'execution-1', 'message-1'], ATTRIBUTION)
    ).resolves.toBe(true)

    const call = mockEval.mock.calls[0]
    const keyCount = call[1] as number
    const args = call.slice(2 + keyCount)
    expect(keyCount).toBe(2)
    expect(args.slice(1)).toEqual(['604800', '0', '', '0', ''])
  })

  it('reports an unavailable legacy cache without affecting modern envelopes', async () => {
    mockRedisState.available = false

    await expect(cacheBillingAttribution('message-1', ATTRIBUTION)).resolves.toBe(false)
    expect(mockEval).not.toHaveBeenCalled()
  })

  it('accepts a semantic-equivalent retry and refreshes every key atomically', async () => {
    const existing = JSON.stringify({
      workspaceId: 'workspace-b',
      payerSubscription: null,
      organizationId: 'org-b',
      billingPeriod: {
        end: '2026-08-01T00:00:00.000Z',
        start: '2026-06-30T20:00:00.000-04:00',
      },
      billingEntity: { id: 'org-b', type: 'organization' },
      billedAccountUserId: 'owner-b',
      actorUserId: 'actor-a',
    })
    mockMget.mockResolvedValue([existing])

    await expect(cacheBillingAttribution('billing-request-1', ATTRIBUTION)).resolves.toBe(true)

    const args = mockEval.mock.calls[0].slice(3)
    expect(JSON.parse(args[0])).toEqual(ATTRIBUTION)
    expect(args.slice(1)).toEqual(['604800', '1', existing])
  })

  it('rejects an attempt to overwrite an existing key with a different snapshot', async () => {
    mockMget.mockResolvedValue([
      JSON.stringify({
        ...ATTRIBUTION,
        actorUserId: 'different-actor',
      }),
    ])

    await expect(cacheBillingAttribution('billing-request-1', ATTRIBUTION)).rejects.toThrow(
      'Billing attribution cache conflict for request key "billing-request-1"'
    )
    expect(mockEval).not.toHaveBeenCalled()
  })

  it('restores a snapshot only from the dedicated callback identity', async () => {
    mockMget.mockResolvedValue([JSON.stringify(ATTRIBUTION)])

    await expect(getCachedBillingAttribution('billing-request-1')).resolves.toEqual(ATTRIBUTION)
    expect(mockMget).toHaveBeenCalledWith(expect.any(String))
  })

  it('restores a legacy checkpoint from its message billing suffix', async () => {
    mockMget.mockResolvedValue([null, JSON.stringify(ATTRIBUTION)])

    await expect(getCachedBillingAttribution('message-1-billing')).resolves.toEqual(ATTRIBUTION)
    expect(mockMget.mock.calls[0]).toHaveLength(2)
  })

  it('fails closed on malformed cached snapshots', async () => {
    mockMget.mockResolvedValue([JSON.stringify({ workspaceId: 'workspace-b' })])

    await expect(getCachedBillingAttribution('message-1')).rejects.toThrow(
      'missing actor, workspace, or billed account'
    )
  })
})
