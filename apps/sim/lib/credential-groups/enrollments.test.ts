/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  createCredentialGroupInvitationLink,
  deleteCredentialGroupEnrollment,
  listCredentialGroupEnrollments,
  resendCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import { CREDENTIAL_GROUP_PROVIDER_IDS } from '@/lib/credential-groups/providers'
import { sendEmail } from '@/lib/messaging/email/mailer'

const MAX_CONNECTION_SUMMARIES = CREDENTIAL_GROUP_PROVIDER_IDS.length * 3

/**
 * The invitation fixtures below are dated relative to a fixed point in the enrollment
 * window, and the code under test compares them against the wall clock. Pinning the
 * clock keeps those literals meaningful and keeps the suite deterministic — dating the
 * expiry to a real future instant only moves the failure, it does not remove it.
 */
const NOW = new Date('2026-08-11T12:10:00.000Z')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

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

  it('continues pagination when the cursor enrollment was deleted between pages', async () => {
    const remainingEnrollment = {
      ...ENROLLMENT,
      id: 'enrollment-2',
      invitedAt: new Date('2026-08-10T12:00:00.000Z'),
    }
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }, { enrollment: remainingEnrollment }])
      .mockResolvedValueOnce([{ options: [] }])
      .mockResolvedValueOnce([{ enrollment: remainingEnrollment }])

    const firstPage = await listCredentialGroupEnrollments('workspace-1', 'group-1', 1, undefined, {
      statuses: ['invited', 'in_progress', 'completed', 'delivery_failed'],
    })
    if (!firstPage.nextCursor) throw new Error('Expected a next enrollment cursor')
    const result = await listCredentialGroupEnrollments(
      'workspace-1',
      'group-1',
      50,
      firstPage.nextCursor,
      { statuses: ['invited', 'in_progress', 'completed', 'delivery_failed'] }
    )

    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(result.enrollments).toHaveLength(1)
    expect(result.enrollments[0]?.id).toBe(remainingEnrollment.id)
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(4)
    expect(inArray).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.status, [
      'invited',
      'in_progress',
      'completed',
      'delivery_failed',
    ])
  })

  it('rejects a malformed enrollment cursor', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ options: [] }])

    await expect(
      listCredentialGroupEnrollments('workspace-1', 'group-1', 50, 'not-a-cursor')
    ).rejects.toMatchObject({ message: 'Enrollment cursor is invalid', status: 400 })

    expect(dbChainMockFns.limit).toHaveBeenCalledOnce()
  })
})

describe('createCredentialGroupInvitationLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('issues a fresh enrollment token without sending email', async () => {
    const issued = {
      ...ENROLLMENT,
      email: 'person@example.com',
      status: 'invited' as const,
      sentAt: null,
      completedAt: null,
    }
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
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([issued])

    const result = await createCredentialGroupInvitationLink(
      'workspace-1',
      'group-1',
      'user-1',
      ' Person@Example.COM '
    )

    expect(result.enrollment).toMatchObject({
      id: ENROLLMENT.id,
      email: 'person@example.com',
      status: 'invited',
      sentAt: null,
    })
    expect(new URL(result.invitationLink).pathname).toMatch(
      /^\/credential-groups\/enroll\/[0-9a-f-]+$/
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialGroupId: 'group-1',
        email: 'person@example.com',
        createdBy: 'user-1',
        sentAt: null,
      })
    )
    expect(sendEmail).not.toHaveBeenCalled()
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

describe('deleteCredentialGroupEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('deletes the enrollment and lets its foreign-key cascade remove managed credentials', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ email: ENROLLMENT.email }])
    dbChainMockFns.returning.mockResolvedValueOnce([ENROLLMENT])

    const result = await deleteCredentialGroupEnrollment('workspace-1', 'group-1', ENROLLMENT.id)

    expect(result.id).toBe(ENROLLMENT.id)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalledOnce()
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment)
  })
})

describe('completeCredentialGroupEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
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

  it('completes when the recipient skips every optional account', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollment: { ...ENROLLMENT, status: 'invited' },
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
        status: 'invited',
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
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: ENROLLMENT.id }])

    await expect(completeCredentialGroupEnrollment('invitation-token')).resolves.toBe(true)

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment)
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.credential)
    expect(adapter.getPolicy).not.toHaveBeenCalled()
  })
})
