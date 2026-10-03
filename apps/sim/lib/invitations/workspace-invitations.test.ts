import { db } from '@sim/db'
import { member, user as userTable } from '@sim/db/schema'
import {
  auditMock,
  auditMockFns,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import {
  billingOrganizationMock,
  billingOrganizationMockFns,
} from '@sim/testing/mocks/billing-organization.mock'
import {
  invitationsSendMock,
  invitationsSendMockFns,
} from '@sim/testing/mocks/invitations-send.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { permissionCheckMock } from '@sim/testing/mocks/permission-check.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { DbOrTx } from '@/lib/db/types'
import type { CreatePendingInvitationInput } from '@/lib/invitations/send'

const {
  MockDirectGrantContextChangedError,
  mockAcquireInvitationMutationLocks,
  mockValidateSeatAvailability,
  mockGrantWorkspaceAccessDirectly,
} = vi.hoisted(() => ({
  MockDirectGrantContextChangedError: class extends Error {},
  mockAcquireInvitationMutationLocks: vi.fn(),
  mockValidateSeatAvailability: vi.fn(),
  mockGrantWorkspaceAccessDirectly: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/invitations/locks', () => ({
  acquireInvitationMutationLocks: mockAcquireInvitationMutationLocks,
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@/lib/invitations/direct-grant', () => ({
  DirectGrantContextChangedError: MockDirectGrantContextChangedError,
  grantWorkspaceAccessDirectly: mockGrantWorkspaceAccessDirectly,
}))

vi.mock('@/lib/invitations/send', () => invitationsSendMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)

vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

import {
  createWorkspaceInvitation,
  prepareWorkspaceInvitationContext,
} from '@/lib/invitations/workspace-invitations'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceInvitePolicy } from '@/lib/workspaces/policy'
import { validateInvitationsAllowed } from '@/ee/access-control/utils/permission-check'

const {
  mockAcquireOrganizationMutationLock,
  mockAcquireOrganizationUserMutationLocks,
  mockGetUserOrganization,
} = organizationMembershipMockFns
const { mockGetEffectiveWorkspacePermission, mockGetWorkspaceWithOwner } = permissionsMockFns
const mockCaptureServerEvent = posthogServerMockFns.mockCaptureServerEvent
const {
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
  mockRevertPendingInvitationGrants,
  mockFindPendingGrantWorkspaceIds,
  mockFindPendingOrganizationInvitation,
} = invitationsSendMockFns
const mockGetInvitePlanCategoryForUser = workspacesPolicyMockFns.mockGetInvitePlanCategoryForUser
const mockIsOrganizationOwnerOrAdmin = billingOrganizationMockFns.mockIsOrganizationOwnerOrAdmin

function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>
    }
    thenable.limit = vi.fn(() => Promise.resolve(result))
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

function makeTarget(workspaceId: string, organizationId: string | null = 'org-1') {
  return {
    workspaceId,
    workspaceDetails: {
      id: workspaceId,
      name: `Workspace ${workspaceId}`,
      ownerId: 'user-1',
      organizationId,
      billedAccountUserId: 'user-1',
    },
    invitePolicy: {
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId,
      upgradeRequired: false,
    },
  }
}

function makeContext(workspaceIds = ['ws-1'], organizationId: string | null = 'org-1') {
  return {
    inviterId: 'user-1',
    inviterName: 'Owner',
    inviterEmail: 'owner@example.com',
    organizationId,
    targets: workspaceIds.map((id) => makeTarget(id, organizationId)),
    // The function only reads the fields above at runtime.
  } as Parameters<typeof createWorkspaceInvitation>[0]['context']
}

const request = createMockRequest(
  'POST',
  {},
  {},
  'http://localhost/api/workspaces/invitations/batch'
)

afterAll(resetEnvFlagsMock)

describe('createWorkspaceInvitation', () => {
  beforeEach(() => {
    resetDbChainMock()
    /** Production default; the billing-disabled case opts out explicitly. */
    setEnvFlags({ isBillingEnabled: true })
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    mockAcquireInvitationMutationLocks.mockResolvedValue(undefined)
    mockAcquireOrganizationMutationLock.mockResolvedValue(undefined)
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace ws-1',
      ownerId: 'user-1',
      organizationId: 'org-1',
      billedAccountUserId: 'user-1',
    })
    mockGetEffectiveWorkspacePermission.mockResolvedValue('admin')
    mockGrantWorkspaceAccessDirectly.mockResolvedValue({ outcome: 'added', permission: 'write' })
    mockCreatePendingInvitation.mockResolvedValue({
      invitationId: 'inv-1',
      token: 'tok-1',
      expiresAt: new Date(),
      created: true,
      addedWorkspaceIds: ['ws-1'],
      grants: [{ workspaceId: 'ws-1', permission: 'write' }],
      mutationUpdatedAt: new Date('2026-07-30T12:00:00.000Z'),
      mutationOrganizationId: 'org-1',
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockCancelPendingInvitation.mockResolvedValue(true)
    mockRevertPendingInvitationGrants.mockResolvedValue(true)
    mockFindPendingGrantWorkspaceIds.mockResolvedValue(new Set())
    mockFindPendingOrganizationInvitation.mockResolvedValue(null)
    mockGetInvitePlanCategoryForUser.mockResolvedValue('free')
  })

  it('rejects an existing workspace member without upgrading their permission', async () => {
    queueWhereResponses([
      [{ id: 'user-2', email: 'member@example.com' }],
      [{ workspaceId: 'ws-1' }],
    ])
    mockGetUserOrganization.mockResolvedValueOnce({ organizationId: 'org-1', role: 'member' })

    await expect(
      createWorkspaceInvitation({
        context: makeContext(),
        email: 'member@example.com',
        permission: 'admin',
        request,
      })
    ).rejects.toThrow('already has access')

    expect(mockGrantWorkspaceAccessDirectly).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it.each(['admin', 'owner'] as const)(
    'rejects inviting an organization %s who already inherits workspace access',
    async (role) => {
      queueTableRows(userTable, [{ id: 'user-2', email: 'member@example.com' }])
      queueTableRows(member, [{ role: 'owner' }])
      queueTableRows(member, [{ role }])
      mockGetUserOrganization.mockResolvedValueOnce({
        organizationId: 'org-1',
        memberId: 'member-2',
        role,
      })

      await expect(
        createWorkspaceInvitation({
          context: makeContext(['ws-1', 'ws-2']),
          email: 'member@example.com',
          permission: 'write',
          request,
        })
      ).rejects.toThrow('already has access to every selected workspace')

      expect(mockGrantWorkspaceAccessDirectly).not.toHaveBeenCalled()
      expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
      expect(mockSendInvitationEmail).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
      expect(mockAcquireOrganizationUserMutationLocks).toHaveBeenCalledOnce()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    }
  )

  it.each(['member', 'admin'] as const)(
    'preserves current membership after a concurrent demotion in ordinary %s invitations',
    async (membership) => {
      queueTableRows(userTable, [{ id: 'user-2' }])
      queueTableRows(member, [{ role: 'member' }])
      queueTableRows(member, [{ role: 'member' }])
      mockGetUserOrganization.mockResolvedValueOnce({
        organizationId: 'org-1',
        memberId: 'member-2',
        role: 'admin',
      })

      const result = await createWorkspaceInvitation({
        context: makeContext(),
        email: 'member@example.com',
        permission: 'write',
        membership,
        request,
      })

      expect(result).toMatchObject({ outcome: 'added', workspaceIds: ['ws-1'] })
      expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
        mockGrantWorkspaceAccessDirectly.mock.invocationCallOrder[0]
      )
      expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ userId: 'user-2', existingPermissionPolicy: 'preserve' })
      )
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
      expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
    }
  )

  it('reconciles workspace access when an inherited admin was demoted before the locked check', async () => {
    queueTableRows(userTable, [{ id: 'user-2' }])
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(member, [{ role: 'member' }])
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      memberId: 'member-2',
      role: 'admin',
    })

    const result = await createWorkspaceInvitation({
      context: makeContext(),
      email: 'member@example.com',
      membership: 'member',
      permission: 'write',
      existingAccessPolicy: 'ensure-at-least',
    })

    expect(result).toMatchObject({
      outcome: 'added',
      workspaceIds: ['ws-1'],
      instantAdd: true,
    })
    expect(mockAcquireInvitationMutationLocks).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      invitationIds: [],
      workspaceIds: ['ws-1'],
    })
    expect(mockAcquireInvitationMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]
    )
    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.for.mock.invocationCallOrder[0]
    )
    expect(mockGetEffectiveWorkspacePermission).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      expect.objectContaining({ id: 'ws-1', organizationId: 'org-1' }),
      expect.anything()
    )
    expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ userId: 'user-2', permission: 'write' })
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it.each(['admin', 'owner'] as const)(
    'does not inherit workspace access from a different organization %s role',
    async (role) => {
      queueWhereResponses([[{ id: 'user-3', email: 'ext@example.com' }], []])
      mockGetUserOrganization.mockResolvedValueOnce({ organizationId: 'org-2', role })

      const result = await createWorkspaceInvitation({
        context: makeContext(),
        email: 'ext@example.com',
        permission: 'read',
        request,
      })

      expect(result.membershipIntent).toBe('external')
      expect(result.workspaceIds).toEqual(['ws-1'])
      expect(mockGrantWorkspaceAccessDirectly).not.toHaveBeenCalled()
      expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipIntent: 'external',
          grants: [{ workspaceId: 'ws-1', permission: 'read' }],
        })
      )
    }
  )

  it('creates an external pending invitation when the user belongs to a different org', async () => {
    queueWhereResponses([[{ id: 'user-3', email: 'ext@example.com' }], []])
    mockGetUserOrganization.mockResolvedValueOnce({ organizationId: 'org-2', role: 'member' })

    const result = await createWorkspaceInvitation({
      context: makeContext(),
      email: 'ext@example.com',
      permission: 'read',
      request,
    })

    expect(result.instantAdd).toBeFalsy()
    expect(mockGrantWorkspaceAccessDirectly).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workspace', membershipIntent: 'external' })
    )
    expect(mockSendInvitationEmail).toHaveBeenCalled()
  })

  it('rechecks invitee membership after locks and rejects a concurrent org join', async () => {
    queueTableRows(userTable, [{ id: 'user-4', email: 'noorg@example.com' }])
    mockGetUserOrganization
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ organizationId: 'org-2', role: 'member' })
    mockCreatePendingInvitation.mockImplementationOnce(
      async (input: CreatePendingInvitationInput) => {
        await input.validateLockedContext?.({
          tx: dbChainMock.db as unknown as DbOrTx,
          organizationId: 'org-1',
          workspaceIds: ['ws-1'],
        })
        throw new Error('unreachable')
      }
    )

    await expect(
      createWorkspaceInvitation({
        context: makeContext(),
        email: 'noorg@example.com',
        permission: 'write',
        request,
      })
    ).rejects.toMatchObject({ status: 409 })

    expect(mockAcquireOrganizationUserMutationLocks).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-4',
      organizationIds: ['org-1'],
    })
    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetWorkspaceWithOwner.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.for).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.for.mock.invocationCallOrder[1]).toBeLessThan(
      mockGetEffectiveWorkspacePermission.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.from).toHaveBeenCalledWith(member)
  })

  it('runs application admission under the organization lock before creating an invitation', async () => {
    queueTableRows(userTable, [])
    const refusal = new ForbiddenOperationError('PERMISSION_DENIED', 'Invitations disabled')
    const validateLockedWorkspace = vi.fn(async () => {
      throw refusal
    })
    const write = vi.fn()
    mockCreatePendingInvitation.mockImplementationOnce(
      async (input: CreatePendingInvitationInput) => {
        await db.transaction(async (tx) => {
          expect(input.validateLockedContext).toBeTypeOf('function')
          await input.validateLockedContext?.({
            tx,
            organizationId: 'org-1',
            workspaceIds: ['ws-1'],
          })
          write()
        })
      }
    )
    await expect(
      createWorkspaceInvitation({
        context: makeContext(),
        email: 'new@example.com',
        validateLockedWorkspace,
      })
    ).rejects.toBe(refusal)
    expect(validateLockedWorkspace).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ id: 'ws-1', organizationId: 'org-1' })
    )
    expect(mockAcquireOrganizationMutationLock.mock.invocationCallOrder[0]).toBeLessThan(
      validateLockedWorkspace.mock.invocationCallOrder[0]
    )
    expect(mockGetEffectiveWorkspacePermission.mock.invocationCallOrder[0]).toBeLessThan(
      validateLockedWorkspace.mock.invocationCallOrder[0]
    )
    expect(write).not.toHaveBeenCalled()
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('refuses to grant organization Admin to a workspace-only administrator', async () => {
    /**
     * Organization Admin carries admin on every workspace the org owns plus
     * member and billing management, so workspace-scoped authority must not
     * escalate into it. Enforced server-side because the batch endpoint is
     * reachable without the modal.
     */
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    queueWhereResponses([[]])

    await expect(
      createWorkspaceInvitation({
        context: makeContext(),
        email: 'new@example.com',
        permission: 'write',
        membership: 'admin',
        request,
      })
    ).rejects.toThrow('Only an organization owner or admin')

    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('rejects an explicit external invite for an invitee with no paid plan', async () => {
    queueWhereResponses([[{ id: 'user-5', email: 'free@example.com' }], []])
    mockGetUserOrganization.mockResolvedValueOnce(null)
    mockGetInvitePlanCategoryForUser.mockResolvedValueOnce('free')

    await expect(
      createWorkspaceInvitation({
        context: makeContext(),
        email: 'free@example.com',
        permission: 'write',
        membership: 'external',
        request,
      })
    ).rejects.toThrow('not on a paid Sim plan')

    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('rejects an external invite on a personal workspace', async () => {
    queueWhereResponses([[{ id: 'user-7', email: 'pro@example.com' }], []])

    await expect(
      createWorkspaceInvitation({
        context: makeContext(['ws-personal'], null),
        email: 'pro@example.com',
        permission: 'write',
        membership: 'external',
        request,
      })
    ).rejects.toThrow('only available on organization workspaces')
  })

  it('reuses an existing Enterprise seat reservation when extending a pending invitation', async () => {
    queueTableRows(userTable, [])
    const context = makeContext(['ws-2'])
    context.targets[0].invitePolicy.requiresSeat = true
    mockCreatePendingInvitation.mockImplementationOnce(
      async (input: CreatePendingInvitationInput) => {
        await input.validateLockedContext?.({
          tx: dbChainMock.db as unknown as DbOrTx,
          organizationId: 'org-1',
          workspaceIds: ['ws-2'],
        })
        return {
          invitationId: 'inv-existing',
          token: 'tok-existing',
          expiresAt: new Date(),
          created: false,
          addedWorkspaceIds: ['ws-2'],
          grants: [{ workspaceId: 'ws-2', permission: 'write' }],
          mutationUpdatedAt: new Date('2026-07-30T12:00:00.000Z'),
          mutationOrganizationId: 'org-1',
        }
      }
    )
    mockFindPendingOrganizationInvitation.mockResolvedValueOnce({ id: 'inv-existing' })

    await createWorkspaceInvitation({
      context,
      email: 'new@example.com',
      permission: 'write',
      request,
    })

    expect(mockValidateSeatAvailability).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).toHaveBeenCalled()
  })

  it('checks a new Enterprise seat reservation under the organization lock', async () => {
    queueTableRows(userTable, [])
    const context = makeContext(['ws-2'])
    context.targets[0].invitePolicy.requiresSeat = true
    mockValidateSeatAvailability.mockResolvedValueOnce({
      canInvite: false,
      reason: 'No available seats.',
    })
    mockCreatePendingInvitation.mockImplementationOnce(
      async (input: CreatePendingInvitationInput) => {
        await input.validateLockedContext?.({
          tx: dbChainMock.db as unknown as DbOrTx,
          organizationId: 'org-1',
          workspaceIds: ['ws-2'],
        })
        throw new Error('unreachable')
      }
    )

    await expect(
      createWorkspaceInvitation({
        context,
        email: 'new@example.com',
        permission: 'write',
        request,
      })
    ).rejects.toMatchObject({ status: 400 })

    expect(mockAcquireOrganizationMutationLock).toHaveBeenCalled()
    expect(mockValidateSeatAvailability).toHaveBeenCalledWith('org-1', 1, {
      executor: dbChainMock.db,
    })
    expect(mockAcquireOrganizationMutationLock.mock.invocationCallOrder[0]).toBeLessThan(
      mockValidateSeatAvailability.mock.invocationCallOrder[0]
    )
  })

  it.each([false, true])(
    'uses live seat policy when preflight requiresSeat was %s',
    async (preflightRequiresSeat) => {
      queueTableRows(userTable, [])
      const context = makeContext()
      context.targets[0].invitePolicy.requiresSeat = preflightRequiresSeat
      const validateLockedWorkspace = vi.fn(async () => ({
        ...context.targets[0].invitePolicy,
        requiresSeat: !preflightRequiresSeat,
      }))
      const write = vi.fn()
      mockValidateSeatAvailability.mockResolvedValueOnce({
        canInvite: false,
        reason: 'No available seats.',
      })
      mockCreatePendingInvitation.mockImplementationOnce(
        async (input: CreatePendingInvitationInput) => {
          await db.transaction(async (tx) => {
            await input.validateLockedContext?.({
              tx,
              organizationId: 'org-1',
              workspaceIds: ['ws-1'],
            })
            write()
          })
          return {
            invitationId: 'inv-1',
            token: 'tok-1',
            grants: [{ workspaceId: 'ws-1', permission: 'read' }],
          }
        }
      )
      const result = createWorkspaceInvitation({
        context,
        email: 'new@example.com',
        validateLockedWorkspace,
      })
      if (preflightRequiresSeat) {
        await expect(result).resolves.toMatchObject({ id: 'inv-1' })
        expect(mockValidateSeatAvailability).not.toHaveBeenCalled()
        expect(write).toHaveBeenCalledTimes(1)
      } else {
        await expect(result).rejects.toMatchObject({ message: 'No available seats.', status: 400 })
        expect(mockValidateSeatAvailability).toHaveBeenCalledWith('org-1', 1, { executor: db })
        expect(write).not.toHaveBeenCalled()
        expect(mockSendInvitationEmail).not.toHaveBeenCalled()
        expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
      }
    }
  )

  it('reverts only the added grants when a merged invitation fails to send', async () => {
    queueWhereResponses([[]])
    mockCreatePendingInvitation.mockResolvedValueOnce({
      invitationId: 'inv-existing',
      token: 'tok-existing',
      expiresAt: new Date(),
      created: false,
      addedWorkspaceIds: ['ws-2'],
      grants: [
        { workspaceId: 'ws-1', permission: 'write' },
        { workspaceId: 'ws-2', permission: 'write' },
      ],
      mutationUpdatedAt: new Date('2026-07-30T12:00:00.000Z'),
      mutationOrganizationId: 'org-1',
    })
    mockSendInvitationEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' })

    await expect(
      createWorkspaceInvitation({
        context: makeContext(['ws-2']),
        email: 'new@example.com',
        permission: 'write',
        request,
      })
    ).rejects.toThrow('smtp down')

    expect(mockCancelPendingInvitation).not.toHaveBeenCalled()
    expect(mockRevertPendingInvitationGrants).toHaveBeenCalledWith({
      invitationId: 'inv-existing',
      workspaceIds: ['ws-2'],
      expectedUpdatedAt: new Date('2026-07-30T12:00:00.000Z'),
      expectedOrganizationId: 'org-1',
    })
  })
})

/**
 * The capability runs after the role check, never before it. Refusing on
 * `invitations.send` first would answer a non-admin with a distinct `403`
 * naming an organization setting, which tells a bystander in the same
 * organization how another workspace's permission group is configured.
 */
describe('prepareWorkspaceInvitationContext refusal ordering', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.mocked(validateInvitationsAllowed).mockResolvedValue(undefined)
    vi.mocked(getWorkspaceInvitePolicy).mockResolvedValue({
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: 'org-1',
      upgradeRequired: false,
    } as unknown as Awaited<ReturnType<typeof getWorkspaceInvitePolicy>>)
  })

  it('still refuses an admin whose permission group withholds invitations', async () => {
    vi.mocked(hasWorkspaceAdminAccess).mockResolvedValue(true)
    vi.mocked(validateInvitationsAllowed).mockRejectedValue(
      new Error('Sending invitations is not available under your permission group')
    )

    await expect(
      prepareWorkspaceInvitationContext({
        workspaceIds: ['ws-1'],
        inviterId: 'user-1',
        inviterName: 'Owner',
      })
    ).rejects.toThrow('Sending invitations is not available under your permission group')
    expect(validateInvitationsAllowed).toHaveBeenCalledWith('user-1', 'ws-1')
  })
})
