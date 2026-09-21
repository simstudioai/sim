/** @vitest-environment node */
import { invitation } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lock: vi.fn(), authority: vi.fn() }))
vi.mock('@/lib/invitations/core', async (original) => ({
  ...(await original<typeof import('@/lib/invitations/core')>()),
  lockInvitationForMutation: mocks.lock,
  requireInvitationResendAuthority: mocks.authority,
}))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { persistInvitationResend } from '@/lib/invitations/send'

const revision = new Date('2026-01-01')
const input = {
  invitationId: 'inv',
  actorUserId: 'actor',
  expectedOrganizationId: 'org',
  expectedUpdatedAt: revision,
  nextToken: 'new-token',
  nextExpiresAt: new Date('2099-02-01'),
}
beforeEach(() => {
  vi.resetAllMocks()
  resetDbChainMock()
  mocks.lock.mockResolvedValue({
    id: 'inv',
    organizationId: 'org',
    expiresAt: new Date('2099-01-01'),
    grants: [],
  })
  dbChainMockFns.returning.mockResolvedValue([{ id: 'inv' }])
})
describe('resend token persistence', () => {
  it('rechecks authority under the invitation locks and conditionally updates the original pending revision', async () => {
    await persistInvitationResend(input)
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), 'inv', {
      lockCurrentGrantWorkspaces: true,
    })
    expect(mocks.authority).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'inv' }),
      'actor',
      'org'
    )
    expect(mocks.authority.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.update.mock.invocationCallOrder[0]
    )
    const [predicate] = dbChainMockFns.where.mock.calls[0]
    for (const [column, value] of [
      [invitation.status, 'pending'],
      [invitation.updatedAt, revision],
      [invitation.organizationId, 'org'],
    ])
      expect(
        hasMockCondition(
          predicate,
          (node) => node.type === 'eq' && node.left === column && node.right === value
        )
      ).toBe(true)
  })

  it('rejects a concurrent revision change or acceptance', async () => {
    dbChainMockFns.returning.mockResolvedValue([])
    await expect(persistInvitationResend(input)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects canonical organization changes without touching the token', async () => {
    mocks.lock.mockResolvedValue({ organizationId: 'different' })
    await expect(persistInvitationResend(input)).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects demotion and expiration during delivery', async () => {
    mocks.authority.mockRejectedValueOnce(
      new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Admin required')
    )
    await expect(persistInvitationResend(input)).rejects.toMatchObject({ code: 'forbidden' })
    mocks.lock.mockResolvedValue({ organizationId: 'org', expiresAt: new Date('2000-01-01') })
    await expect(persistInvitationResend(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
