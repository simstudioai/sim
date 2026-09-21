/**
 * @vitest-environment node
 */
import { credential, knowledgeBase, member, workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSetOrgMemberUsageLimit } = vi.hoisted(() => ({
  mockSetOrgMemberUsageLimit: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/member-limits', () => ({
  setOrgMemberUsageLimit: mockSetOrgMemberUsageLimit,
}))

import {
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'

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

  it('preserves organization indexes and cached documents when a creator leaves with no workspaces', async () => {
    queueTableRows(member, [{ id: 'membership', userId: 'departing', role: 'admin' }])
    queueTableRows(member, [{ userId: 'surviving-owner' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'membership' }])

    const result = await removeUserFromOrganization({
      userId: 'departing',
      organizationId: 'organization-a',
      memberId: 'membership',
      skipBillingLogic: true,
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.update).toHaveBeenCalledWith(knowledgeBase)
    expect(dbChainMockFns.update).toHaveBeenCalledWith(workspaceFiles)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(credential)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      userId: 'surviving-owner',
      updatedAt: expect.any(Date),
    })
    for (const table of [knowledgeBase, workspaceFiles]) {
      expect(
        dbChainMockFns.where.mock.calls.some(
          ([condition]) =>
            hasMockCondition(
              condition,
              (node) =>
                node.type === 'eq' &&
                node.left === table.organizationId &&
                node.right === 'organization-a'
            ) &&
            hasMockCondition(
              condition,
              (node) =>
                node.type === 'eq' && node.left === table.userId && node.right === 'departing'
            ) &&
            hasMockCondition(
              condition,
              (node) => node.type === 'isNull' && node.column === table.workspaceId
            )
        )
      ).toBe(true)
    }
  })
  it.each(['40001', '40P01', '55P03'])(
    'preserves retryable transaction failure %s',
    async (code) => {
      const failure = Object.assign(new Error('retry transaction'), { code })
      dbChainMockFns.transaction.mockRejectedValueOnce(failure)
      await expect(
        removeExternalUserFromOrganizationWorkspaces({
          organizationId: 'org-1',
          userId: 'external',
        })
      ).rejects.toBe(failure)
      queueTableRows(member, [{ id: 'membership', userId: 'target', role: 'member' }])
      dbChainMockFns.transaction.mockRejectedValueOnce(failure)
      await expect(
        removeUserFromOrganization({
          organizationId: 'org-1',
          userId: 'target',
          memberId: 'membership',
        })
      ).rejects.toBe(failure)
    }
  )

  it('rejects an actor demoted before the locked removal', async () => {
    queueTableRows(member, [{ id: 'membership', userId: 'target', role: 'member' }])
    queueTableRows(member, [{ id: 'actor-membership', role: 'member' }])
    await expect(
      removeUserFromOrganization({
        organizationId: 'org-1',
        userId: 'target',
        memberId: 'membership',
        actorUserId: 'actor',
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
