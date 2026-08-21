/**
 * @vitest-environment node
 */
import { invitation, member } from '@sim/db/schema'
import {
  auditMock,
  auditMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAcquireInvitationMutationLocks,
  mockAcquireOrganizationUserMutationLocks,
  mockGetUserOrganization,
  mockGetEffectiveWorkspacePermission,
  mockGetWorkspaceWithOwner,
  mockRevokeInvitationWorkspaceGrantTx,
  mockSyncWorkspaceEnvCredentials,
  mockSendWorkspaceAddedEmail,
  mockCaptureServerEvent,
  mockWorkspaceMemberAdded,
  mockEnqueueOutboxEvent,
} = vi.hoisted(() => ({
  mockAcquireInvitationMutationLocks: vi.fn(),
  mockAcquireOrganizationUserMutationLocks: vi.fn(),
  mockGetUserOrganization: vi.fn(),
  mockGetEffectiveWorkspacePermission: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockRevokeInvitationWorkspaceGrantTx: vi.fn(),
  mockSyncWorkspaceEnvCredentials: vi.fn(),
  mockSendWorkspaceAddedEmail: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockWorkspaceMemberAdded: vi.fn(),
  mockEnqueueOutboxEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mockAcquireOrganizationUserMutationLocks,
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/invitations/locks', () => ({
  acquireInvitationMutationLocks: mockAcquireInvitationMutationLocks,
}))

vi.mock('@/lib/invitations/core', () => ({
  revokeInvitationWorkspaceGrantTx: mockRevokeInvitationWorkspaceGrantTx,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { workspaceMemberAdded: mockWorkspaceMemberAdded },
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}))

vi.mock('@/lib/credentials/environment', () => ({
  syncWorkspaceEnvCredentials: mockSyncWorkspaceEnvCredentials,
}))

vi.mock('@/lib/invitations/send', () => ({
  sendWorkspaceAddedEmail: mockSendWorkspaceAddedEmail,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getEffectiveWorkspacePermission: mockGetEffectiveWorkspacePermission,
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import {
  DIRECT_GRANT_EMAIL_EVENT_TYPE,
  DirectGrantContextChangedError,
  directGrantOutboxHandlers,
  grantWorkspaceAccessDirectly,
} from '@/lib/invitations/direct-grant'

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
    mockAcquireInvitationMutationLocks.mockResolvedValue(undefined)
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'member',
    })
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'user-1',
    })
    mockGetEffectiveWorkspacePermission.mockResolvedValue('admin')
    mockRevokeInvitationWorkspaceGrantTx.mockResolvedValue({
      revoked: true,
      invitationCancelled: false,
    })
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
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      DIRECT_GRANT_EMAIL_EVENT_TYPE,
      expect.objectContaining({ email: 'member@example.com', workspaceId: 'ws-1' })
    )
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetEffectiveWorkspacePermission.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.for).toHaveBeenCalledTimes(3)
    expect(dbChainMockFns.for.mock.invocationCallOrder[1]).toBeLessThan(
      mockGetEffectiveWorkspacePermission.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.from).toHaveBeenCalledWith(member)
  })

  it('delivers the transactionally enqueued notification through the outbox', async () => {
    await directGrantOutboxHandlers[DIRECT_GRANT_EMAIL_EVENT_TYPE](
      {
        email: 'member@example.com',
        inviterName: 'Owner',
        workspaceId: 'ws-1',
        workspaceName: 'Workspace 1',
      },
      {
        eventId: 'email-1',
        eventType: DIRECT_GRANT_EMAIL_EVENT_TYPE,
        attempts: 0,
        maxAttempts: 10,
        signal: new AbortController().signal,
        checkpointPayload: vi.fn(),
      }
    )

    expect(mockSendWorkspaceAddedEmail).toHaveBeenCalledWith({
      email: 'member@example.com',
      inviterName: 'Owner',
      workspaceId: 'ws-1',
      workspaceName: 'Workspace 1',
    })
  })

  it('retries provider-declined notification delivery instead of dropping it', async () => {
    mockSendWorkspaceAddedEmail.mockResolvedValueOnce({
      success: false,
      error: 'Provider unavailable',
    })

    await expect(
      directGrantOutboxHandlers[DIRECT_GRANT_EMAIL_EVENT_TYPE](
        {
          email: 'member@example.com',
          inviterName: 'Owner',
          workspaceId: 'ws-1',
          workspaceName: 'Workspace 1',
        },
        {
          eventId: 'email-1',
          eventType: DIRECT_GRANT_EMAIL_EVENT_TYPE,
          attempts: 0,
          maxAttempts: 10,
          signal: new AbortController().signal,
          checkpointPayload: vi.fn(),
        }
      )
    ).rejects.toThrow('Provider unavailable')
  })

  it('rejects malformed durable notification payloads instead of dropping fields', async () => {
    await expect(
      directGrantOutboxHandlers[DIRECT_GRANT_EMAIL_EVENT_TYPE](
        {
          email: 'member@example.com',
          inviterName: 'Owner',
          workspaceId: 'ws-1',
        },
        {
          eventId: 'email-1',
          eventType: DIRECT_GRANT_EMAIL_EVENT_TYPE,
          attempts: 0,
          maxAttempts: 10,
          signal: new AbortController().signal,
          checkpointPayload: vi.fn(),
        }
      )
    ).rejects.toThrow('Invalid workspace-added email payload')

    expect(mockSendWorkspaceAddedEmail).not.toHaveBeenCalled()
  })

  it('preserves an actor-less platform admin in audit instead of substituting the owner', async () => {
    await grantWorkspaceAccessDirectly({
      ...baseInput,
      auditActor: { id: null, name: 'Admin Panel', email: null },
    })

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Admin Panel',
        actorEmail: null,
      })
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

  it('can explicitly ensure a minimum permission for provisioning reconciliation', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'perm-1', permissionType: 'read' }])

    const result = await grantWorkspaceAccessDirectly({
      ...baseInput,
      permission: 'write',
      existingPermissionPolicy: 'ensure-at-least',
    })

    expect(result).toEqual({
      outcome: 'updated',
      previousPermission: 'read',
      permission: 'write',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ permissionType: 'write' })
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.role_changed', resourceId: 'ws-1' })
    )
    expect(mockWorkspaceMemberAdded).not.toHaveBeenCalled()
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
    queueTableRows(invitation, [{ invitationId: 'old-inv' }])
    queueTableRows(invitation, [{ invitationId: 'old-inv' }])

    await grantWorkspaceAccessDirectly({ ...baseInput })

    expect(mockRevokeInvitationWorkspaceGrantTx).toHaveBeenCalledWith(expect.anything(), {
      invitationId: 'old-inv',
      workspaceId: 'ws-1',
    })
  })

  it('locks before re-reading scope and aborts when the workspace moved', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValueOnce({
      id: 'ws-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      organizationId: 'org-2',
      workspaceMode: 'organization',
      billedAccountUserId: 'user-3',
    })

    await expect(grantWorkspaceAccessDirectly({ ...baseInput })).rejects.toBeInstanceOf(
      DirectGrantContextChangedError
    )

    expect(mockAcquireInvitationMutationLocks).toHaveBeenCalledWith(expect.anything(), {
      invitationIds: [],
      workspaceIds: ['ws-1'],
    })
    expect(mockAcquireOrganizationUserMutationLocks).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-2',
      organizationIds: ['org-1'],
    })
    expect(mockAcquireInvitationMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]
    )
    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetWorkspaceWithOwner.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})
