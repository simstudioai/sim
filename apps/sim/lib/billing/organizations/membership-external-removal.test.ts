import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import {
  organizationMemberLimitsMock,
  organizationMemberLimitsMockFns,
} from '@sim/testing/mocks/organization-member-limits.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

import {
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'
import { MEMORY_CLEANUP_EVENT } from '@/lib/mothership/memories/cleanup-event'

const mockSetOrgMemberUsageLimit = organizationMemberLimitsMockFns.mockSetOrgMemberUsageLimit
const { mockEnqueueOutboxEvents } = outboxServiceMockFns

/** The private-memory erasure a removal queues for the departing user (D106 in Mothership). */
function memberErasure(userId: string) {
  return [
    expect.anything(),
    MEMORY_CLEANUP_EVENT,
    [
      expect.objectContaining({
        request: {
          version: 1,
          target: { kind: 'organization_member', organizationId: 'org-1', userId },
        },
      }),
    ],
  ]
}

describe('external organization access removal', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnv({ COPILOT_API_KEY: 'test-key' })
  })

  afterAll(() => {
    resetEnvMock()
  })

  it("erases the departing user's private Mothership memory in the organization", async () => {
    await removeExternalUserFromOrganizationWorkspaces({
      organizationId: 'org-1',
      userId: 'external-user',
    })
    expect(mockEnqueueOutboxEvents).toHaveBeenCalledWith(...memberErasure('external-user'))

    queueTableRows(member, [{ id: 'membership', userId: 'target', role: 'member' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'membership' }])
    await removeUserFromOrganization({
      organizationId: 'org-1',
      userId: 'target',
      memberId: 'membership',
      skipBillingLogic: true,
      onError: 'throw',
    })
    expect(mockEnqueueOutboxEvents).toHaveBeenCalledWith(...memberErasure('target'))
  })

  it('erases nothing when a removal does not commit', async () => {
    queueTableRows(member, [])
    queueTableRows(member, [{ id: 'new-membership' }])
    await expect(
      removeExternalUserFromOrganizationWorkspaces({ organizationId: 'org-1', userId: 'external' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockEnqueueOutboxEvents).not.toHaveBeenCalled()
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

  it('rejects an actor demoted before the locked removal', async () => {
    queueTableRows(member, [{ id: 'membership', userId: 'target', role: 'member' }])
    queueTableRows(member, [{ id: 'actor-membership', role: 'member' }])
    await expect(
      removeUserFromOrganization({
        organizationId: 'org-1',
        userId: 'target',
        memberId: 'membership',
        actorUserId: 'actor',
        onError: 'throw',
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('reports membership appearing during external removal as a conflict', async () => {
    queueTableRows(member, [])
    queueTableRows(member, [{ id: 'new-membership' }])
    await expect(
      removeExternalUserFromOrganizationWorkspaces({ organizationId: 'org-1', userId: 'external' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
