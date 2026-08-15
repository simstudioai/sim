/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { adapter } = vi.hoisted(() => ({
  adapter: {
    getPolicy: vi.fn(),
    hasRequiredScopes: vi.fn(),
  },
}))

vi.mock('@/components/emails/render', () => ({
  renderCredentialGroupInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: vi.fn() }))

vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => adapter,
}))

import {
  completeCredentialGroupEnrollment,
  listCredentialGroupEnrollments,
  resendCredentialGroupEnrollment,
  revokeCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import { CREDENTIAL_GROUP_PROVIDER_IDS } from '@/lib/credential-groups/providers'
import { sendEmail } from '@/lib/messaging/email/mailer'

const MAX_CONNECTION_SUMMARIES = CREDENTIAL_GROUP_PROVIDER_IDS.length * 3

const ENROLLMENT = {
  id: 'enrollment-1',
  credentialGroupId: 'group-1',
  email: 'alex@example.com',
  status: 'completed' as const,
  invitationTokenHash: 'a'.repeat(64),
  invitationExpiresAt: new Date('2026-08-18T12:00:00.000Z'),
  invitedAt: new Date('2026-08-11T12:00:00.000Z'),
  sentAt: new Date('2026-08-11T12:00:01.000Z'),
  completedAt: new Date('2026-08-11T12:05:00.000Z'),
  revokedAt: null,
  lastDeliveryError: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-11T12:00:00.000Z'),
  updatedAt: new Date('2026-08-11T12:05:00.000Z'),
}

describe('listCredentialGroupEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns bounded provider summaries instead of materializing every credential', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [{ id: 'option-1', status: 'active' }] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce([
        {
          enrollmentId: ENROLLMENT.id,
          providerId: 'google-email',
          status: 'active',
          count: 2,
        },
        {
          enrollmentId: ENROLLMENT.id,
          providerId: 'google-email',
          status: 'needs_reauth',
          count: 1,
        },
      ])

    const result = await listCredentialGroupEnrollments('workspace-1', 'group-1', 50)

    expect(result.enrollments[0]?.connections).toEqual([
      { provider: 'gmail', status: 'active', count: 2 },
      { provider: 'gmail', status: 'needs_reauth', count: 1 },
    ])
    expect(dbChainMockFns.limit).toHaveBeenNthCalledWith(3, MAX_CONNECTION_SUMMARIES + 1)
  })

  it('fails fast when a managed credential uses an unsupported provider', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [{ id: 'option-1', status: 'active' }] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce([
        {
          enrollmentId: ENROLLMENT.id,
          providerId: 'unexpected-provider',
          status: 'active',
          count: 1,
        },
      ])

    await expect(listCredentialGroupEnrollments('workspace-1', 'group-1', 50)).rejects.toThrow(
      'Unsupported managed credential provider: unexpected-provider'
    )
  })

  it('rejects connection summaries beyond the bounded provider-state cardinality', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [{ id: 'option-1', status: 'active' }] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce(
        Array.from({ length: MAX_CONNECTION_SUMMARIES + 1 }, (_, index) => ({
          enrollmentId: ENROLLMENT.id,
          providerId: 'google-email',
          status: 'active',
          count: index + 1,
        }))
      )

    await expect(listCredentialGroupEnrollments('workspace-1', 'group-1', 50)).rejects.toThrow(
      'Managed credential connection summaries exceed the supported provider states'
    )
  })

  it('rejects an unbounded enrollment page request', async () => {
    await expect(listCredentialGroupEnrollments('workspace-1', 'group-1', 101)).rejects.toThrow(
      'Credential group enrollment limit must be between 1 and 100'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})

describe('resendCredentialGroupEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('does not reactivate an enrollment revoked while resend waits for its lifecycle lock', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          workspaceId: 'workspace-1',
          workspaceName: 'Workspace',
          groupId: 'group-1',
          groupName: 'Group',
          groupStatus: 'active',
          options: [{ id: 'option-1', status: 'active' }],
        },
      ])
      .mockResolvedValueOnce([{ enrollment: { ...ENROLLMENT, status: 'invited' } }])
      .mockResolvedValueOnce([{ ...ENROLLMENT, status: 'invited' }])
      .mockResolvedValueOnce([{ ...ENROLLMENT, status: 'revoked' }])

    await expect(
      resendCredentialGroupEnrollment('workspace-1', 'group-1', ENROLLMENT.id, 'user-1', 'Inviter')
    ).rejects.toThrow('Revoked enrollment cannot be resent')

    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rotates the invitation without hiding credentials from a completed enrollment', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          workspaceId: 'workspace-1',
          workspaceName: 'Workspace',
          groupId: 'group-1',
          groupName: 'Group',
          groupStatus: 'active',
          options: [{ id: 'option-1', status: 'active' }],
        },
      ])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce([ENROLLMENT])
      .mockResolvedValueOnce([ENROLLMENT])
    dbChainMockFns.returning
      .mockResolvedValueOnce([ENROLLMENT])
      .mockResolvedValueOnce([{ ...ENROLLMENT, sentAt: new Date() }])
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: true, message: 'sent' })

    const result = await resendCredentialGroupEnrollment(
      'workspace-1',
      'group-1',
      ENROLLMENT.id,
      'user-1',
      'Inviter'
    )

    expect(result.status).toBe('completed')
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'completed', completedAt: ENROLLMENT.completedAt })
    )
  })
})

describe('revokeCredentialGroupEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('deletes every managed credential collected under the revoked enrollment', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ email: ENROLLMENT.email }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...ENROLLMENT, status: 'revoked', revokedAt: new Date() },
    ])

    const result = await revokeCredentialGroupEnrollment('workspace-1', 'group-1', ENROLLMENT.id)

    expect(result.status).toBe('revoked')
    expect(dbChainMockFns.update).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment)
    expect(dbChainMockFns.delete).toHaveBeenCalledOnce()
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.credential)
  })
})

describe('completeCredentialGroupEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    adapter.getPolicy.mockResolvedValue({
      provider: 'gmail',
      providerId: 'google-email',
      authorizationAppId: 'google:client',
      requiredScopes: ['scope'],
      scopeVersion: 1,
    })
    adapter.hasRequiredScopes.mockReturnValue(true)
  })

  it('returns unavailable when revocation wins before completion acquires the lifecycle lock', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollment: { ...ENROLLMENT, status: 'in_progress' },
        groupId: 'group-1',
        groupName: 'Group',
        groupStatus: 'active',
        options: [
          {
            id: 'option-1',
            provider: 'gmail',
            label: 'Gmail',
            required: true,
            status: 'active',
          },
        ],
        workspaceId: 'workspace-1',
        workspaceName: 'Workspace',
        workspaceOwnerId: 'owner-1',
        inviterName: 'Inviter',
      },
    ])
    queueTableRows(schemaMock.credential, [
      {
        optionId: 'option-1',
        status: 'active',
        scopeVersion: 1,
        authorizationAppId: 'google:client',
        grantedScopes: ['scope'],
        displayName: 'alex@example.com',
        metadata: { email: 'alex@example.com' },
        grantedAt: new Date('2026-08-11T12:05:00.000Z'),
      },
    ])
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        status: 'revoked',
        invitationTokenHash: ENROLLMENT.invitationTokenHash,
        invitationExpiresAt: ENROLLMENT.invitationExpiresAt,
      },
    ])

    await expect(completeCredentialGroupEnrollment('invitation-token')).resolves.toBeNull()

    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses completion when a connection needs reauthorization under the row locks', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollment: { ...ENROLLMENT, status: 'in_progress' },
        groupId: 'group-1',
        groupName: 'Group',
        groupStatus: 'active',
        options: [
          {
            id: 'option-1',
            provider: 'gmail',
            label: 'Gmail',
            required: true,
            status: 'active',
          },
        ],
        workspaceId: 'workspace-1',
        workspaceName: 'Workspace',
        workspaceOwnerId: 'owner-1',
        inviterName: 'Inviter',
      },
    ])
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        status: 'in_progress',
        invitationTokenHash: ENROLLMENT.invitationTokenHash,
        invitationExpiresAt: ENROLLMENT.invitationExpiresAt,
      },
    ])
    queueTableRows(schemaMock.credentialGroup, [
      {
        status: 'active',
        options: [
          {
            id: 'option-1',
            provider: 'gmail',
            label: 'Gmail',
            required: true,
            status: 'active',
          },
        ],
      },
    ])
    queueTableRows(schemaMock.credential, [
      {
        optionId: 'option-1',
        status: 'needs_reauth',
        scopeVersion: 1,
        authorizationAppId: 'google:client',
        grantedScopes: ['scope'],
        grantedAt: new Date('2026-08-11T12:05:00.000Z'),
      },
    ])

    await expect(completeCredentialGroupEnrollment('invitation-token')).resolves.toBe(false)

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(adapter.getPolicy).not.toHaveBeenCalled()
  })
})
