/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetUserOrganization,
  mockSyncWorkspaceEnvCredentials,
  mockCancelPendingInvitation,
  mockSendWorkspaceAddedEmail,
  mockCaptureServerEvent,
  mockWorkspaceMemberAdded,
} = vi.hoisted(() => ({
  mockGetUserOrganization: vi.fn(),
  mockSyncWorkspaceEnvCredentials: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
  mockSendWorkspaceAddedEmail: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockWorkspaceMemberAdded: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { workspaceMemberAdded: mockWorkspaceMemberAdded },
}))

vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: mockSyncWorkspaceEnvCredentials,
}))

vi.mock('@/lib/invitations/send', () => ({
  cancelPendingInvitation: mockCancelPendingInvitation,
  sendWorkspaceAddedEmail: mockSendWorkspaceAddedEmail,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import { grantWorkspaceAccessDirectly, isSameOrgMember } from '@/lib/invitations/direct-grant'

/**
 * Drives `db.select().from().where()` results in call order. Both an awaited
 * `where()` and a chained `.limit()` resolve to the same per-call value.
 */
function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>
      orderBy: ReturnType<typeof vi.fn>
      returning: ReturnType<typeof vi.fn>
      groupBy: ReturnType<typeof vi.fn>
    }
    thenable.limit = vi.fn(() => Promise.resolve(result))
    thenable.orderBy = vi.fn(() => Promise.resolve(result))
    thenable.returning = vi.fn(() => Promise.resolve(result))
    thenable.groupBy = vi.fn(() => Promise.resolve(result))
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

const baseInput = {
  userId: 'user-2',
  email: 'Member@Example.com',
  workspaceId: 'ws-1',
  workspaceName: 'Workspace 1',
  permission: 'write' as const,
  organizationId: 'org-1',
  actorId: 'user-1',
  actorName: 'Owner',
  actorEmail: 'owner@example.com',
}

describe('grantWorkspaceAccessDirectly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockSendWorkspaceAddedEmail.mockResolvedValue({ success: true })
    // Insert path reports the new row via `.returning()`.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'perm-new' }])
  })

  it('inserts a permission row when the user has no existing access', async () => {
    const result = await grantWorkspaceAccessDirectly({ ...baseInput })

    expect(result).toEqual({ outcome: 'added', permission: 'write' })
    expect(dbChainMockFns.insert).toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.added', resourceId: 'ws-1' })
    )
    expect(mockWorkspaceMemberAdded).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' })
    )
    expect(mockSendWorkspaceAddedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'member@example.com', workspaceId: 'ws-1' })
    )
  })

  it('reports unchanged (no audit/email) when a concurrent insert wins the race', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await grantWorkspaceAccessDirectly({ ...baseInput })

    expect(result).toEqual({ outcome: 'unchanged', permission: 'write' })
    expect(dbChainMockFns.insert).toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mockWorkspaceMemberAdded).not.toHaveBeenCalled()
    expect(mockSendWorkspaceAddedEmail).not.toHaveBeenCalled()
  })

  it('does not upgrade an existing lower permission (invites never modify access)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'perm-1', permissionType: 'read' }])

    const result = await grantWorkspaceAccessDirectly({ ...baseInput, permission: 'admin' })

    expect(result).toEqual({ outcome: 'unchanged', permission: 'read' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mockSendWorkspaceAddedEmail).not.toHaveBeenCalled()
  })

  it('no-ops when the user already has access', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'perm-1', permissionType: 'admin' }])

    const result = await grantWorkspaceAccessDirectly({ ...baseInput, permission: 'write' })

    expect(result).toEqual({ outcome: 'unchanged', permission: 'admin' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mockWorkspaceMemberAdded).not.toHaveBeenCalled()
    expect(mockSendWorkspaceAddedEmail).not.toHaveBeenCalled()
  })

  it('skips the email when notify is false', async () => {
    const result = await grantWorkspaceAccessDirectly({ ...baseInput, notify: false })

    expect(result.outcome).toBe('added')
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalled()
    expect(mockSendWorkspaceAddedEmail).not.toHaveBeenCalled()
  })

  it('syncs workspace env credentials when env variables exist', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([]) // existing permission lookup
      .mockResolvedValueOnce([{ variables: { API_KEY: 'x', BASE_URL: 'y' } }]) // env lookup

    await grantWorkspaceAccessDirectly({ ...baseInput })

    expect(mockSyncWorkspaceEnvCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        actingUserId: 'user-2',
        envKeys: ['API_KEY', 'BASE_URL'],
      })
    )
  })

  it('supersedes lingering pending workspace invitations for the same email', async () => {
    queueWhereResponses([
      [], // existing permission lookup (transaction)
      [{ invitationId: 'old-inv' }], // supersede lookup
      [], // env lookup
    ])

    await grantWorkspaceAccessDirectly({ ...baseInput })

    expect(mockCancelPendingInvitation).toHaveBeenCalledWith('old-inv')
  })
})

describe('isSameOrgMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns false when the workspace has no organization', async () => {
    expect(await isSameOrgMember('user-2', null)).toBe(false)
    expect(mockGetUserOrganization).not.toHaveBeenCalled()
  })

  it('returns false when the user belongs to no organization', async () => {
    mockGetUserOrganization.mockResolvedValueOnce(null)
    expect(await isSameOrgMember('user-2', 'org-1')).toBe(false)
  })

  it('returns true when the user belongs to the workspace organization', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({ organizationId: 'org-1', role: 'member' })
    expect(await isSameOrgMember('user-2', 'org-1')).toBe(true)
  })

  it('returns false when the user belongs to a different organization', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({ organizationId: 'org-2', role: 'member' })
    expect(await isSameOrgMember('user-2', 'org-1')).toBe(false)
  })
})
