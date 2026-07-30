/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  dbChainMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetUserOrganization,
  mockValidateSeatAvailability,
  mockGrantWorkspaceAccessDirectly,
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
  mockRevertPendingInvitationGrants,
  mockFindPendingGrantWorkspaceIds,
  mockGetInvitePlanCategoryForUser,
  mockWorkspaceMemberInvited,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockGetUserOrganization: vi.fn(),
  mockValidateSeatAvailability: vi.fn(),
  mockGrantWorkspaceAccessDirectly: vi.fn(),
  mockCreatePendingInvitation: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
  mockRevertPendingInvitationGrants: vi.fn(),
  mockFindPendingGrantWorkspaceIds: vi.fn(),
  mockGetInvitePlanCategoryForUser: vi.fn(),
  mockWorkspaceMemberInvited: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/billing/validation/seat-management', () => ({
  validateSeatAvailability: mockValidateSeatAvailability,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { workspaceMemberInvited: mockWorkspaceMemberInvited },
}))

vi.mock('@/lib/invitations/direct-grant', () => ({
  grantWorkspaceAccessDirectly: mockGrantWorkspaceAccessDirectly,
}))

vi.mock('@/lib/invitations/send', () => ({
  createPendingInvitation: mockCreatePendingInvitation,
  sendInvitationEmail: mockSendInvitationEmail,
  cancelPendingInvitation: mockCancelPendingInvitation,
  revertPendingInvitationGrants: mockRevertPendingInvitationGrants,
  findPendingGrantWorkspaceIds: mockFindPendingGrantWorkspaceIds,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn(),
}))

vi.mock('@/lib/workspaces/policy', () => ({
  getWorkspaceInvitePolicy: vi.fn(),
  getInvitePlanCategoryForUser: mockGetInvitePlanCategoryForUser,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateInvitationsAllowed: vi.fn(),
}))

import { createWorkspaceInvitation } from '@/lib/invitations/workspace-invitations'

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
    vi.clearAllMocks()
    resetDbChainMock()
    /** Production default; the billing-disabled case opts out explicitly. */
    setEnvFlags({ isBillingEnabled: true })
    mockGrantWorkspaceAccessDirectly.mockResolvedValue({ outcome: 'added', permission: 'write' })
    mockCreatePendingInvitation.mockResolvedValue({
      invitationId: 'inv-1',
      token: 'tok-1',
      expiresAt: new Date(),
      created: true,
      addedWorkspaceIds: ['ws-1'],
      grants: [{ workspaceId: 'ws-1', permission: 'write' }],
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockFindPendingGrantWorkspaceIds.mockResolvedValue(new Set())
    mockGetInvitePlanCategoryForUser.mockResolvedValue('free')
  })

  it('directly grants access to an existing member of the workspace organization', async () => {
    queueWhereResponses([[{ id: 'user-2', email: 'member@example.com' }], []])
    mockGetUserOrganization.mockResolvedValueOnce({ organizationId: 'org-1', role: 'member' })

    const result = await createWorkspaceInvitation({
      context: makeContext(),
      email: 'member@example.com',
      permission: 'write',
      request,
    })

    expect(result.instantAdd).toBe(true)
    expect(result.outcome).toBe('added')
    expect(mockGrantWorkspaceAccessDirectly).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        workspaceId: 'ws-1',
        permission: 'write',
        organizationId: 'org-1',
      })
    )
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
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

  it('creates an internal pending invitation when the registered user has no org', async () => {
    queueWhereResponses([[{ id: 'user-4', email: 'noorg@example.com' }], []])
    mockGetUserOrganization.mockResolvedValueOnce(null)

    const result = await createWorkspaceInvitation({
      context: makeContext(),
      email: 'noorg@example.com',
      permission: 'write',
      request,
    })

    expect(result.instantAdd).toBeFalsy()
    expect(mockGrantWorkspaceAccessDirectly).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workspace', membershipIntent: 'internal', role: 'member' })
    )
  })

  it('creates a pending invitation for a brand-new email', async () => {
    queueWhereResponses([[]])

    const result = await createWorkspaceInvitation({
      context: makeContext(),
      email: 'new@example.com',
      permission: 'read',
      request,
    })

    expect(result.instantAdd).toBeFalsy()
    expect(mockGetUserOrganization).not.toHaveBeenCalled()
    expect(mockGrantWorkspaceAccessDirectly).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workspace', membershipIntent: 'internal' })
    )
  })

  it('stamps an admin organization role when the inviter picks Admin membership', async () => {
    queueWhereResponses([[]])

    await createWorkspaceInvitation({
      context: makeContext(),
      email: 'new@example.com',
      permission: 'write',
      membership: 'admin',
      request,
    })

    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ membershipIntent: 'internal', role: 'admin' })
    )
  })

  it('allows an external invite with billing disabled, where nobody has a plan', async () => {
    /**
     * The paid-plan requirement is seat economics: an external collaborator takes
     * no seat, so somebody else must be paying for them. With billing off there
     * are no seats and no subscriptions, so every account reads as free —
     * enforcing it would leave a self-hosted deployment no way to grant
     * workspace-only access without an organization join and a workspace sweep.
     */
    setEnvFlags({ isBillingEnabled: false })
    queueWhereResponses([[{ id: 'user-9', email: 'selfhost@example.com' }], []])
    mockGetUserOrganization.mockResolvedValueOnce(null)

    const result = await createWorkspaceInvitation({
      context: makeContext(),
      email: 'selfhost@example.com',
      permission: 'write',
      membership: 'external',
      request,
    })

    expect(result.membershipIntent).toBe('external')
    /** Short-circuits before the plan lookup — there is nothing to look up. */
    expect(mockGetInvitePlanCategoryForUser).not.toHaveBeenCalled()
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

  it('rejects an explicit external invite for an email with no Sim account', async () => {
    queueWhereResponses([[]])

    await expect(
      createWorkspaceInvitation({
        context: makeContext(),
        email: 'stranger@example.com',
        permission: 'write',
        membership: 'external',
        request,
      })
    ).rejects.toThrow('not on a paid Sim plan')

    expect(mockGetInvitePlanCategoryForUser).not.toHaveBeenCalled()
    expect(mockCreatePendingInvitation).not.toHaveBeenCalled()
  })

  it('allows an explicit external invite for an invitee on their own paid plan', async () => {
    queueWhereResponses([[{ id: 'user-6', email: 'pro@example.com' }], []])
    mockGetUserOrganization.mockResolvedValueOnce(null)
    mockGetInvitePlanCategoryForUser.mockResolvedValueOnce('pro')

    const result = await createWorkspaceInvitation({
      context: makeContext(),
      email: 'pro@example.com',
      permission: 'write',
      membership: 'external',
      request,
    })

    expect(result.membershipIntent).toBe('external')
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ membershipIntent: 'external' })
    )
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

  it('sends one invitation covering every selected workspace', async () => {
    queueWhereResponses([[]])
    mockCreatePendingInvitation.mockResolvedValueOnce({
      invitationId: 'inv-2',
      token: 'tok-2',
      expiresAt: new Date(),
      created: true,
      addedWorkspaceIds: ['ws-1', 'ws-2'],
      grants: [
        { workspaceId: 'ws-1', permission: 'write' },
        { workspaceId: 'ws-2', permission: 'write' },
      ],
    })

    const result = await createWorkspaceInvitation({
      context: makeContext(['ws-1', 'ws-2']),
      email: 'new@example.com',
      permission: 'write',
      request,
    })

    expect(result.workspaceIds).toEqual(['ws-1', 'ws-2'])
    expect(mockCreatePendingInvitation).toHaveBeenCalledTimes(1)
    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        grants: [
          { workspaceId: 'ws-1', permission: 'write' },
          { workspaceId: 'ws-2', permission: 'write' },
        ],
      })
    )
    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1)
  })

  it('drops workspaces already covered by a pending invitation instead of failing', async () => {
    queueWhereResponses([[]])
    mockFindPendingGrantWorkspaceIds.mockResolvedValueOnce(new Set(['ws-1']))

    await createWorkspaceInvitation({
      context: makeContext(['ws-1', 'ws-2']),
      email: 'new@example.com',
      permission: 'write',
      request,
    })

    expect(mockCreatePendingInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ grants: [{ workspaceId: 'ws-2', permission: 'write' }] })
    )
  })

  it('rejects when every selected workspace is already invited', async () => {
    queueWhereResponses([[]])
    mockFindPendingGrantWorkspaceIds.mockResolvedValueOnce(new Set(['ws-1', 'ws-2']))

    await expect(
      createWorkspaceInvitation({
        context: makeContext(['ws-1', 'ws-2']),
        email: 'new@example.com',
        permission: 'write',
        request,
      })
    ).rejects.toThrow('has already been invited')
  })

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
    })
  })
})
