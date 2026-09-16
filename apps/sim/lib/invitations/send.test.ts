/**
 * @vitest-environment node
 */
import { workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPendingInvitation,
  createPendingInvitation,
  GrantlessInvitationError,
  revertPendingInvitationGrants,
} from '@/lib/invitations/send'

function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>
      orderBy: ReturnType<typeof vi.fn>
      returning: ReturnType<typeof vi.fn>
    }
    thenable.limit = vi.fn(() => Promise.resolve(result))
    thenable.orderBy = vi.fn(() => Promise.resolve(result))
    thenable.returning = vi.fn(() => Promise.resolve(result))
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

function hydrationRows(params?: {
  status?: 'pending' | 'accepted'
  organizationId?: string | null
  updatedAt?: Date
}) {
  const organizationId = params?.organizationId ?? null
  const rows: unknown[][] = [
    [
      {
        id: 'inv-1',
        kind: 'workspace',
        email: 'invitee@example.com',
        organizationId,
        membershipIntent: 'internal',
        inviterId: 'owner-1',
        role: 'member',
        status: params?.status ?? 'pending',
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: params?.updatedAt ?? new Date('2026-07-30T12:00:00.000Z'),
      },
    ],
    [
      {
        id: 'grant-1',
        workspaceId: 'workspace-1',
        permission: 'write',
        workspaceName: 'Workspace',
      },
    ],
  ]
  if (organizationId) rows.push([{ name: 'Acme' }])
  rows.push([{ name: 'Owner', email: 'owner@example.com' }])
  return rows
}

describe('createPendingInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each(['member', 'admin'] as const)(
    'creates a %s-role organization invitation without workspace grants',
    async (role) => {
      await expect(
        createPendingInvitation({
          kind: 'organization',
          email: 'invitee@example.com',
          inviterId: 'inviter-1',
          organizationId: 'org-1',
          role,
          grants: [],
        })
      ).resolves.toEqual(expect.objectContaining({ grants: [], created: true }))
    }
  )

  it('rejects a grantless organization invitation without an internal organization target', async () => {
    for (const input of [
      { organizationId: null, membershipIntent: 'internal' as const },
      { organizationId: 'org-1', membershipIntent: 'external' as const },
    ]) {
      await expect(
        createPendingInvitation({
          kind: 'organization',
          email: 'invitee@example.com',
          inviterId: 'inviter-1',
          role: 'member',
          grants: [],
          ...input,
        })
      ).rejects.toThrow(GrantlessInvitationError)
    }
  })

  it('rejects a workspace invitation with no workspace grants', async () => {
    await expect(
      createPendingInvitation({
        kind: 'workspace',
        email: 'invitee@example.com',
        inviterId: 'inviter-1',
        organizationId: 'org-1',
        membershipIntent: 'internal',
        role: 'member',
        grants: [],
      })
    ).rejects.toThrow(GrantlessInvitationError)
  })

  it('runs locked-context validation after the shared invitation/workspace locks', async () => {
    const validateLockedContext = vi.fn().mockResolvedValue(undefined)
    queueTableRows(workspace, [{ organizationId: 'org-1' }])
    queueTableRows(workspace, [{ organizationId: 'org-1' }])

    await createPendingInvitation({
      kind: 'workspace',
      email: 'invitee@example.com',
      inviterId: 'inviter-1',
      organizationId: 'org-1',
      membershipIntent: 'internal',
      role: 'member',
      grants: [{ workspaceId: 'workspace-1', permission: 'write' }],
      validateLockedContext,
    })

    expect(validateLockedContext).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workspaceIds: ['workspace-1'],
      })
    )
    expect(dbChainMockFns.execute.mock.invocationCallOrder[0]).toBeLessThan(
      validateLockedContext.mock.invocationCallOrder[0]
    )
  })
})

describe('failed-send compensation', () => {
  const expectedUpdatedAt = new Date('2026-07-30T12:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('cancels an unchanged newly-created pending invitation', async () => {
    queueWhereResponses([
      ...hydrationRows({ updatedAt: expectedUpdatedAt }),
      ...hydrationRows({ updatedAt: expectedUpdatedAt }),
      [{ id: 'inv-1' }],
    ])

    await expect(
      cancelPendingInvitation('inv-1', {
        expectedUpdatedAt,
        expectedOrganizationId: null,
      })
    ).resolves.toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    )
  })

  it('does not cancel an invitation accepted while its email was in flight', async () => {
    queueWhereResponses([
      ...hydrationRows({ status: 'pending', updatedAt: expectedUpdatedAt }),
      ...hydrationRows({ status: 'accepted', updatedAt: expectedUpdatedAt }),
    ])

    await expect(
      cancelPendingInvitation('inv-1', {
        expectedUpdatedAt,
        expectedOrganizationId: null,
      })
    ).resolves.toBe(false)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('does not cancel a pending invitation migrated while its email was in flight', async () => {
    const migratedAt = new Date('2026-07-30T12:00:01.000Z')
    queueWhereResponses([
      ...hydrationRows({ updatedAt: expectedUpdatedAt }),
      ...hydrationRows({ organizationId: 'org-2', updatedAt: migratedAt }),
    ])

    await expect(
      cancelPendingInvitation('inv-1', {
        expectedUpdatedAt,
        expectedOrganizationId: null,
      })
    ).resolves.toBe(false)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('does not delete merged grants after a later migration revision', async () => {
    const migratedAt = new Date('2026-07-30T12:00:01.000Z')
    queueWhereResponses([
      ...hydrationRows({ updatedAt: expectedUpdatedAt }),
      ...hydrationRows({ organizationId: 'org-2', updatedAt: migratedAt }),
    ])

    await expect(
      revertPendingInvitationGrants({
        invitationId: 'inv-1',
        workspaceIds: ['workspace-1'],
        expectedUpdatedAt,
        expectedOrganizationId: null,
      })
    ).resolves.toBe(false)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('does not delete grants after a later same-scope merge touched the invitation', async () => {
    const laterMergeAt = new Date('2026-07-30T12:00:01.000Z')
    queueWhereResponses([
      ...hydrationRows({ organizationId: 'org-1', updatedAt: expectedUpdatedAt }),
      ...hydrationRows({ organizationId: 'org-1', updatedAt: laterMergeAt }),
    ])

    await expect(
      revertPendingInvitationGrants({
        invitationId: 'inv-1',
        workspaceIds: ['workspace-1'],
        expectedUpdatedAt,
        expectedOrganizationId: 'org-1',
      })
    ).resolves.toBe(false)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('deletes only the added grants for an unchanged pending merge', async () => {
    queueWhereResponses([
      ...hydrationRows({ updatedAt: expectedUpdatedAt }),
      ...hydrationRows({ updatedAt: expectedUpdatedAt }),
      [{ id: 'inv-1' }],
      [],
    ])

    await expect(
      revertPendingInvitationGrants({
        invitationId: 'inv-1',
        workspaceIds: ['workspace-1'],
        expectedUpdatedAt,
        expectedOrganizationId: null,
      })
    ).resolves.toBe(true)
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
  })
})
