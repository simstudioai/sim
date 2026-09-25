import { invitation } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lock: vi.fn(), policy: vi.fn() }))
vi.mock('@/lib/invitations/core', async (original) => ({
  ...(await original<typeof import('@/lib/invitations/core')>()),
  lockInvitationForMutation: mocks.lock,
}))

vi.mock('@/lib/invitations/resend-policy', () => ({ lockInvitationResendPolicy: mocks.policy }))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { prepareInvitationResend, revertInvitationResend } from '@/lib/invitations/send'

const revision = new Date('2026-01-01')
const input = {
  invitationId: 'inv',
  actorUserId: 'actor',
  expectedOrganizationId: 'org',
  expectedUpdatedAt: revision,
  currentToken: 'original-token',
}
beforeEach(() => {
  vi.resetAllMocks()
  resetDbChainMock()
  mocks.lock.mockResolvedValue({
    id: 'inv',
    organizationId: 'org',
    status: 'pending',
    token: 'original-token',
    updatedAt: revision,
    expiresAt: new Date('2099-01-01'),
    grants: [],
  })
  dbChainMockFns.returning.mockResolvedValue([{ id: 'inv' }])
})
describe('resend preparation and compensation', () => {
  it('rechecks policy under the invitation locks and conditionally updates the original pending revision', async () => {
    const prepared = await prepareInvitationResend(input)
    expect(prepared).toMatchObject({
      invitationId: 'inv',
      previousToken: 'original-token',
      previousExpiresAt: new Date('2099-01-01'),
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      token: prepared.tokenForEmail,
      expiresAt: prepared.nextExpiresAt,
      updatedAt: prepared.mutationUpdatedAt,
    })
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), 'inv', {
      lockCurrentGrantWorkspaces: true,
    })
    expect(mocks.policy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'inv' }),
      'actor',
      'org'
    )
    expect(mocks.policy.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.update.mock.invocationCallOrder[0]
    )
    const [predicate] = dbChainMockFns.where.mock.calls[0]
    for (const [column, value] of [
      [invitation.status, 'pending'],
      [invitation.token, 'original-token'],
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
    await expect(prepareInvitationResend(input)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('accepts a hydrated legacy revision without comparing a JavaScript Date to a microsecond SQL value', async () => {
    const legacyRevision = new Date('2026-01-01T00:00:00.123456Z')
    mocks.lock.mockResolvedValue({
      id: 'inv',
      organizationId: 'org',
      status: 'pending',
      token: input.currentToken,
      updatedAt: legacyRevision,
      expiresAt: new Date('2099-01-01'),
    })
    await prepareInvitationResend({ ...input, expectedUpdatedAt: legacyRevision })
    const [predicate] = dbChainMockFns.where.mock.calls[0]
    expect(
      hasMockCondition(
        predicate,
        (node) => node.type === 'eq' && node.left === invitation.updatedAt
      )
    ).toBe(false)
  })

  it('rejects canonical organization changes without touching the token', async () => {
    mocks.lock.mockResolvedValue({ organizationId: 'different' })
    await expect(prepareInvitationResend(input)).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects demotion and expiration before delivery', async () => {
    mocks.policy.mockRejectedValueOnce(
      new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Admin required')
    )
    await expect(prepareInvitationResend(input)).rejects.toMatchObject({ code: 'forbidden' })
    mocks.lock.mockResolvedValue({
      id: 'inv',
      organizationId: 'org',
      token: input.currentToken,
      updatedAt: revision,
      status: 'pending',
      expiresAt: new Date('2000-01-01'),
    })
    await expect(prepareInvitationResend(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('restores the previous token and expiry after failed delivery', async () => {
    const prepared = await prepareInvitationResend(input)
    mocks.lock.mockResolvedValue({
      id: 'inv',
      status: 'pending',
      organizationId: prepared.organizationId,
      token: prepared.tokenForEmail,
      updatedAt: prepared.mutationUpdatedAt,
    })
    await expect(revertInvitationResend(prepared)).resolves.toBe(true)
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith({
      token: 'original-token',
      expiresAt: new Date('2099-01-01'),
      updatedAt: expect.any(Date),
    })
  })

  it.each([
    { status: 'accepted' },
    { organizationId: 'other-org' },
    { token: 'newer-resend-token' },
    { updatedAt: new Date('2099-02-01') },
  ])('does not compensate over a later invitation change: %j', async (change) => {
    const prepared = await prepareInvitationResend(input)
    mocks.lock.mockResolvedValue({
      id: 'inv',
      status: 'pending',
      organizationId: prepared.organizationId,
      token: prepared.tokenForEmail,
      updatedAt: prepared.mutationUpdatedAt,
      ...change,
    })
    dbChainMockFns.update.mockClear()
    await expect(revertInvitationResend(prepared)).resolves.toBe(false)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
