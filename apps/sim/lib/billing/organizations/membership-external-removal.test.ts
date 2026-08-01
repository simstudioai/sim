/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSetOrgMemberUsageLimit } = vi.hoisted(() => ({
  mockSetOrgMemberUsageLimit: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/member-limits', () => ({
  setOrgMemberUsageLimit: mockSetOrgMemberUsageLimit,
}))

import { removeExternalUserFromOrganizationWorkspaces } from '@/lib/billing/organizations/membership'

describe('external organization access removal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('clears a stale per-user organization usage cap in the removal transaction', async () => {
    await removeExternalUserFromOrganizationWorkspaces({
      organizationId: 'org-1',
      userId: 'external-user',
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith(
      'org-1',
      'external-user',
      null,
      undefined,
      expect.anything()
    )
  })
})
