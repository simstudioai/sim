import { auditMock, auditMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  credentialsEnvironmentMock,
  credentialsEnvironmentMockFns,
} from '@sim/testing/mocks/credentials-environment.mock'
import {
  invitationsCoreMock,
  invitationsCoreMockFns,
} from '@sim/testing/mocks/invitations-core.mock'
import {
  invitationsSendMock,
  invitationsSendMockFns,
} from '@sim/testing/mocks/invitations-send.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { getMockPlatformEvent, telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'

const { mockAcquireInvitationMutationLocks } = vi.hoisted(() => ({
  mockAcquireInvitationMutationLocks: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

vi.mock('@/lib/invitations/locks', () => ({
  acquireInvitationMutationLocks: mockAcquireInvitationMutationLocks,
}))

vi.mock('@/lib/invitations/core', () => invitationsCoreMock)

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)

vi.mock('@/lib/invitations/send', () => invitationsSendMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)
const mockCaptureServerEvent = posthogServerMockFns.mockCaptureServerEvent
const mockWorkspaceMemberAdded = getMockPlatformEvent('workspaceMemberAdded')

import {
  DirectGrantContextChangedError,
  directGrantOutboxHandlers,
  grantWorkspaceAccessDirectly,
} from '@/lib/invitations/direct-grant'
import { DIRECT_GRANT_EMAIL_EVENT_TYPE } from '@/lib/invitations/direct-grant-event'

const { mockAcquireOrganizationUserMutationLocks, mockGetUserOrganization } =
  organizationMembershipMockFns
const { mockGetEffectiveWorkspacePermission, mockGetWorkspaceWithOwner } = permissionsMockFns
const mockRevokeInvitationWorkspaceGrantTx =
  invitationsCoreMockFns.mockRevokeInvitationWorkspaceGrantTx
const mockSyncWorkspaceEnvCredentials =
  credentialsEnvironmentMockFns.mockSyncWorkspaceEnvCredentials
const mockSendWorkspaceAddedEmail = invitationsSendMockFns.mockSendWorkspaceAddedEmail
const mockEnqueueOutboxEvent = outboxServiceMockFns.mockEnqueueOutboxEvent

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

  it.each(['admin', 'owner'] as const)(
    'preserves an invitee who became organization %s before the transaction without redundant effects',
    async (role) => {
      mockGetUserOrganization.mockResolvedValueOnce({ organizationId: 'org-1', role })

      const result = await grantWorkspaceAccessDirectly({
        ...baseInput,
        existingPermissionPolicy: 'ensure-at-least',
      })

      expect(result).toEqual({ outcome: 'unchanged', permission: 'admin' })
      expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
        dbChainMockFns.for.mock.invocationCallOrder[1]
      )
      expect(dbChainMockFns.for.mock.invocationCallOrder[1]).toBeLessThan(
        mockGetUserOrganization.mock.invocationCallOrder[0]
      )
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
      expect(mockSyncWorkspaceEnvCredentials).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
      expect(mockWorkspaceMemberAdded).not.toHaveBeenCalled()
      expect(mockCaptureServerEvent).not.toHaveBeenCalled()
    }
  )

  it('rechecks application admission after locks and before any grant or side effect', async () => {
    const refusal = new ForbiddenOperationError('PERMISSION_DENIED', 'Invitations disabled')
    const validateLockedWorkspace = vi.fn(async () => {
      throw refusal
    })
    await expect(
      grantWorkspaceAccessDirectly({
        ...baseInput,
        validateLockedWorkspace,
      })
    ).rejects.toBe(refusal)
    expect(validateLockedWorkspace).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ id: 'ws-1', organizationId: 'org-1' })
    )
    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      validateLockedWorkspace.mock.invocationCallOrder[0]
    )
    expect(mockGetEffectiveWorkspacePermission.mock.invocationCallOrder[0]).toBeLessThan(
      validateLockedWorkspace.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockRevokeInvitationWorkspaceGrantTx).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
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
