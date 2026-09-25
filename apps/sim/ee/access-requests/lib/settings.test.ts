import { organizationAccessRequestSettings } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  isAccessRequestEnabled,
  readAccessRequestSettings,
} from '@/ee/access-requests/lib/settings'

beforeEach(() => {
  resetDbChainMock()
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

  it('honors an organization opt-out', async () => {
    queueTableRows(organizationAccessRequestSettings, [{ allowRequests: false }])

    await expect(isAccessRequestEnabled('organization-one')).resolves.toBe(false)
  })

  it('does not reinterpret a failed settings lookup as permission to submit', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(isAccessRequestEnabled('organization-one')).rejects.toThrow('database unavailable')
  })
})
