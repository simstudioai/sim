/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetUserOrganization,
  mockValidateSeatAvailability,
  mockGrantWorkspaceAccessDirectly,
  mockCreatePendingInvitation,
  mockSendInvitationEmail,
  mockCancelPendingInvitation,
  mockFindPendingGrantForWorkspaceEmail,
  mockWorkspaceMemberInvited,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockGetUserOrganization: vi.fn(),
  mockValidateSeatAvailability: vi.fn(),
  mockGrantWorkspaceAccessDirectly: vi.fn(),
  mockCreatePendingInvitation: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
  mockFindPendingGrantForWorkspaceEmail: vi.fn(),
  mockWorkspaceMemberInvited: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
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
  findPendingGrantForWorkspaceEmail: mockFindPendingGrantForWorkspaceEmail,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn(),
}))

vi.mock('@/lib/workspaces/policy', () => ({
  getWorkspaceInvitePolicy: vi.fn(),
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

function makeContext() {
  return {
    workspaceId: 'ws-1',
    inviterId: 'user-1',
    inviterName: 'Owner',
    inviterEmail: 'owner@example.com',
    workspaceDetails: {
      id: 'ws-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      organizationId: 'org-1',
      billedAccountUserId: 'user-1',
    },
    invitePolicy: {
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: 'org-1',
      upgradeRequired: false,
    },
    // The function only reads the fields above at runtime.
  } as Parameters<typeof createWorkspaceInvitation>[0]['context']
}

const request = createMockRequest(
  'POST',
  {},
  {},
  'http://localhost/api/workspaces/invitations/batch'
)

describe('createWorkspaceInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGrantWorkspaceAccessDirectly.mockResolvedValue({ outcome: 'added', permission: 'write' })
    mockCreatePendingInvitation.mockResolvedValue({ invitationId: 'inv-1', token: 'tok-1' })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockFindPendingGrantForWorkspaceEmail.mockResolvedValue(null)
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
      [{ id: 'perm-1', permissionType: 'read' }],
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
      expect.objectContaining({ kind: 'workspace', membershipIntent: 'internal' })
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
})
