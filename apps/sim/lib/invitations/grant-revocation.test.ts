/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { invitation, invitationWorkspaceGrant } from '@sim/db/schema'
import {
  auditMock,
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/invitations/locks', () => ({
  acquireInvitationMutationLocks: vi.fn(),
}))

import { revokeInvitationWorkspaceGrantTx } from '@/lib/invitations/core'

describe('revokeInvitationWorkspaceGrantTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('preserves sibling workspace grants', async () => {
    queueTableRows(invitation, [{ id: 'inv-1' }])
    queueTableRows(invitationWorkspaceGrant, [{ value: 1 }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'grant-1' }])

    await expect(
      revokeInvitationWorkspaceGrantTx(db, {
        invitationId: 'inv-1',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ revoked: true, invitationCancelled: false })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: 'cancelled' })
    )
  })

  it('cancels the invitation only after its final workspace grant is removed', async () => {
    queueTableRows(invitation, [{ id: 'inv-1' }])
    queueTableRows(invitationWorkspaceGrant, [{ value: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'grant-1' }])

    await expect(
      revokeInvitationWorkspaceGrantTx(db, {
        invitationId: 'inv-1',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ revoked: true, invitationCancelled: true })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    )
  })

  it('checks database expiry in the grant deletion itself and leaves expired invitations untouched', async () => {
    queueTableRows(invitation, [{ id: 'inv-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      revokeInvitationWorkspaceGrantTx(db, {
        invitationId: 'inv-1',
        workspaceId: 'ws-1',
        requireUnexpired: true,
      })
    ).resolves.toEqual({ revoked: false, invitationCancelled: false })
    const [predicate] = dbChainMockFns.where.mock.calls[1]
    expect(
      hasMockCondition(
        predicate,
        (node) => Array.isArray(node.strings) && node.strings.join('').includes('clock_timestamp()')
      )
    ).toBe(true)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
})
