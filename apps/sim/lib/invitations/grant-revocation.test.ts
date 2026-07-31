/**
 * @vitest-environment node
 */
import { invitation, invitationWorkspaceGrant } from '@sim/db/schema'
import { auditMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAcquireInvitationMutationLocks } = vi.hoisted(() => ({
  mockAcquireInvitationMutationLocks: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/invitations/locks', () => ({
  acquireInvitationMutationLocks: mockAcquireInvitationMutationLocks,
}))

import { revokeInvitationWorkspaceGrant } from '@/lib/invitations/core'

describe('revokeInvitationWorkspaceGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAcquireInvitationMutationLocks.mockResolvedValue(undefined)
  })

  it('uses the shared lock fence and preserves sibling workspace grants', async () => {
    queueTableRows(invitation, [{ id: 'inv-1' }])
    queueTableRows(invitationWorkspaceGrant, [{ value: 1 }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'grant-1' }])

    await expect(
      revokeInvitationWorkspaceGrant({
        invitationId: 'inv-1',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ revoked: true, invitationCancelled: false })

    expect(mockAcquireInvitationMutationLocks).toHaveBeenCalledWith(expect.anything(), {
      invitationIds: ['inv-1'],
      workspaceIds: ['ws-1'],
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: 'cancelled' })
    )
  })

  it('cancels the invitation only after its final workspace grant is removed', async () => {
    queueTableRows(invitation, [{ id: 'inv-1' }])
    queueTableRows(invitationWorkspaceGrant, [{ value: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'grant-1' }])

    await expect(
      revokeInvitationWorkspaceGrant({
        invitationId: 'inv-1',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ revoked: true, invitationCancelled: true })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    )
  })
})
