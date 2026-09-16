/**
 * @vitest-environment node
 */
import { organizationAccessRequestSettings } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({ mockIsFeatureEnabled: vi.fn() }))

vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))

import {
  isAccessRequestEnabled,
  readAccessRequestSettings,
} from '@/lib/permission-access-requests/settings'

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mockIsFeatureEnabled.mockResolvedValue(true)
})

describe('permission access request settings', () => {
  it('defaults the organization preference on when no settings row exists', async () => {
    queueTableRows(organizationAccessRequestSettings, [])

    await expect(readAccessRequestSettings('organization-one')).resolves.toEqual({
      allowRequests: true,
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'eq',
      left: organizationAccessRequestSettings.organizationId,
      right: 'organization-one',
    })
  })

  it('does not let the default-on preference bypass the global rollout flag', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(isAccessRequestEnabled('organization-one')).resolves.toBe(false)

    expect(mockIsFeatureEnabled).toHaveBeenCalledExactlyOnceWith('permission-access-requests')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('enables requests when rollout is active and the organization has not opted out', async () => {
    queueTableRows(organizationAccessRequestSettings, [])

    await expect(isAccessRequestEnabled('organization-one')).resolves.toBe(true)
  })

  it('honors an organization opt-out while global rollout is active', async () => {
    queueTableRows(organizationAccessRequestSettings, [{ allowRequests: false }])

    await expect(isAccessRequestEnabled('organization-one')).resolves.toBe(false)
  })

  it('preserves an explicit enabled preference', async () => {
    queueTableRows(organizationAccessRequestSettings, [{ allowRequests: true }])

    await expect(isAccessRequestEnabled('organization-one')).resolves.toBe(true)
  })

  it('does not reinterpret a failed settings lookup as permission to submit', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(isAccessRequestEnabled('organization-one')).rejects.toThrow('database unavailable')
  })
})
