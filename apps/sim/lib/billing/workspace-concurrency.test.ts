/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetHighestPrioritySubscription,
  mockGetWorkspaceBilledAccountUserId,
  mockFeatureFlags,
  mockRedisGet,
  mockRedisSet,
  mockRedisDel,
  mockRedisKeys,
  mockGetRedisClient,
} = vi.hoisted(() => ({
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
  mockFeatureFlags: {
    isBillingEnabled: true,
  },
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockRedisKeys: vi.fn(),
  mockGetRedisClient: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

vi.mock('@/lib/core/config/feature-flags', () => mockFeatureFlags)

import {
  getWorkspaceConcurrencyLimit,
  resetWorkspaceConcurrencyLimitCache,
} from '@/lib/billing/workspace-concurrency'

describe('workspace concurrency billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFeatureFlags.isBillingEnabled = true

    mockRedisGet.mockResolvedValue(null)
    mockRedisSet.mockResolvedValue('OK')
    mockRedisDel.mockResolvedValue(1)
    mockRedisKeys.mockResolvedValue([])
    mockGetRedisClient.mockReturnValue({
      get: mockRedisGet,
      set: mockRedisSet,
      del: mockRedisDel,
      keys: mockRedisKeys,
    })
  })

  it('returns free tier when no billed account exists', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue(null)

    await expect(getWorkspaceConcurrencyLimit('workspace-1')).resolves.toBe(5)
  })

  it('returns pro limit for pro billing accounts', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('user-1')
    mockGetHighestPrioritySubscription.mockResolvedValue({
      plan: 'pro_6000',
      metadata: null,
    })

    await expect(getWorkspaceConcurrencyLimit('workspace-1')).resolves.toBe(50)
  })

  it('returns max limit for max plan tiers', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('user-1')
    mockGetHighestPrioritySubscription.mockResolvedValue({
      plan: 'pro_25000',
      metadata: null,
    })

    await expect(getWorkspaceConcurrencyLimit('workspace-1')).resolves.toBe(200)
  })

  it('returns max limit for legacy team plans', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('user-1')
    mockGetHighestPrioritySubscription.mockResolvedValue({
      plan: 'team',
      metadata: null,
    })

    await expect(getWorkspaceConcurrencyLimit('workspace-1')).resolves.toBe(200)
  })

  it('returns enterprise metadata override when present', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('user-1')
    mockGetHighestPrioritySubscription.mockResolvedValue({
      plan: 'enterprise',
      metadata: {
        workspaceConcurrencyLimit: '350',
      },
    })

    await expect(getWorkspaceConcurrencyLimit('workspace-1')).resolves.toBe(350)
  })

  it('uses free-tier limit when billing is disabled', async () => {
    mockFeatureFlags.isBillingEnabled = false
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('user-1')
    mockGetHighestPrioritySubscription.mockResolvedValue({
      plan: 'pro_25000',
      metadata: {
        workspaceConcurrencyLimit: 999,
      },
    })

    await expect(getWorkspaceConcurrencyLimit('workspace-1')).resolves.toBe(5)
  })

  it('uses redis cache when available', async () => {
    mockRedisGet.mockResolvedValueOnce('123')

    await expect(getWorkspaceConcurrencyLimit('workspace-1')).resolves.toBe(123)
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
  })

  it('can clear a specific workspace cache entry', async () => {
    await resetWorkspaceConcurrencyLimitCache('workspace-1')

    expect(mockRedisDel).toHaveBeenCalledWith('workspace-concurrency-limit:workspace-1')
  })
})
