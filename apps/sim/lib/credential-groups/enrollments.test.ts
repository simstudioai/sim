/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq, ilike, inArray, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { adapter } = vi.hoisted(() => ({
  adapter: {
    getPolicy: vi.fn(),
    hasRequiredScopes: vi.fn(),
  },
}))

vi.mock('@/components/emails/credential-groups/render', () => ({
  renderCredentialGroupInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: vi.fn() }))

vi.mock('@/lib/billing/core/subscription', () => ({
  getOrganizationSubscriptionUsable: vi.fn().mockResolvedValue({ plan: 'enterprise' }),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => adapter,
}))

import { renderCredentialGroupInvitationEmail } from '@/components/emails/credential-groups/render'
import { getOrganizationSubscriptionUsable } from '@/lib/billing/core/subscription'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import {
  bindCredentialGroupEnrollmentUser,
  completeCredentialGroupEnrollment,
  createCredentialGroupInvitationLink,
  createCredentialGroupSelfEnrollmentLink,
  deleteCredentialGroupEnrollment,
  getAuthorizedCredentialGroupOAuthContext,
  getAuthorizedPublicCredentialGroupEnrollment,
  getCredentialGroupMcpOAuthContextForEnrollment,
  getCredentialGroupOAuthContextForEnrollment,
  listCredentialGroupEnrollments,
  resendCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { CREDENTIAL_GROUP_PROVIDER_IDS } from '@/lib/credential-groups/providers'
import { sendEmail } from '@/lib/messaging/email/mailer'

const MAX_CONNECTION_SUMMARIES = (CREDENTIAL_GROUP_PROVIDER_IDS.length + 1) * 3

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

describe('focused public enrollment projection', () => {
  const identity = {
    workspaceId: 'workspace-1',
    credentialGroupId: 'group-1',
    enrollmentId: ENROLLMENT.id,
    email: ENROLLMENT.email,
    invitationTokenHash: ENROLLMENT.invitationTokenHash,
  }
  const options = [
    { id: 'first', provider: 'gmail', label: 'First account', status: 'active', required: false },
    { id: 'second', provider: 'gmail', label: 'Second account', status: 'active', required: false },
    { id: 'broken-slack', provider: 'slack', label: 'Slack', status: 'active', required: false },
    {
      id: 'disabled',
      provider: 'gmail',
      label: 'Disabled account',
      status: 'disabled',
      required: false,
    },
  ]
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollment: ENROLLMENT,
        groupId: identity.credentialGroupId,
        groupName: 'Accounts',
        groupStatus: 'active',
        options,
        workspaceId: identity.workspaceId,
        workspaceName: 'Workspace',
        workspaceOwnerId: 'owner',
        inviterName: 'Admin',
      },
    ])
    adapter.getPolicy.mockImplementation(async (option) => {
      if (option.provider === 'slack')
        throw new CredentialGroupProviderConfigurationError('Unconfigured Slack')
      return {
        provider: 'gmail',
        providerId: 'google-email',
        authorizationAppId: 'google:app',
        scopeVersion: 1,
        requiredScopes: ['openid'],
      }
    })
  })

  it('loads only the exact active option policy so unrelated providers cannot block Search enrollment', async () => {
    const result = await getAuthorizedPublicCredentialGroupEnrollment(identity, {
      optionId: 'second',
    })
    expect(result?.options.map((option) => option.id)).toEqual(['second'])
    expect(result?.mcpServers).toEqual([])
    expect(adapter.getPolicy).toHaveBeenCalledExactlyOnceWith(options[1], {
      workspaceId: identity.workspaceId,
      credentialGroupId: identity.credentialGroupId,
    })
  })

  it.each(['missing', 'disabled'])(
    'never substitutes another option when %s is requested',
    async (optionId) => {
      const result = await getAuthorizedPublicCredentialGroupEnrollment(identity, { optionId })
      expect(result?.options).toEqual([])
      expect(adapter.getPolicy).not.toHaveBeenCalled()
    }
  )
})

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

  it('includes personal GitLab accounts in an enrollment with no OAuth options', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce([
        { enrollmentId: ENROLLMENT.id, providerId: 'gitlab', status: 'active', count: 2 },
      ])
    const result = await listCredentialGroupEnrollments('workspace-1', 'group-1', 50)
    expect(result.enrollments[0]?.connections).toEqual([
      { provider: 'gitlab', status: 'active', count: 2 },
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

  it('projects an exact provider in SQL while retaining contributors with no account', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          options: [
            { id: 'first', status: 'active' },
            { id: 'second', status: 'active' },
          ],
        },
      ])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce([])
    const result = await listCredentialGroupEnrollments('workspace-1', 'group-1', 50, undefined, {
      optionId: 'second',
    })
    expect(inArray).toHaveBeenCalledWith(schemaMock.credential.credentialGroupOptionId, ['second'])
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.mcpServers)
    expect(result.enrollments).toEqual([
      expect.objectContaining({ id: ENROLLMENT.id, connections: [], mcpConnections: [] }),
    ])
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ options: [] }])
      .mockResolvedValueOnce([{ enrollment: remainingEnrollment }])
      .mockResolvedValueOnce([])

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
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(6)
    expect(inArray).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.status, [
      'invited',
      'in_progress',
      'completed',
      'delivery_failed',
    ])
  })

  it('filters email in SQL before the bounded page and preserves exact-email compatibility', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ options: [] }]).mockResolvedValueOnce([])
    const result = await listCredentialGroupEnrollments(
      { kind: 'organization', organizationId: 'org-1' },
      'group-1',
      50,
      undefined,
      { search: '  A_%\\b  ', email: 'exact@example.com' }
    )
    expect(ilike).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.email, '%A\\_\\%\\\\b%')
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.email, 'exact@example.com')
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroup.organizationId, 'org-1')
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroup.id, 'group-1')
    expect(dbChainMockFns.limit).toHaveBeenNthCalledWith(2, 51)
    expect(result).toEqual({ enrollments: [], nextCursor: null })
  })

  it('ignores blank search and rejects oversized direct search before database loading', async () => {
    await expect(
      listCredentialGroupEnrollments('workspace-1', 'group-1', 50, undefined, {
        search: 'x'.repeat(321),
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    dbChainMockFns.limit.mockResolvedValueOnce([{ options: [] }]).mockResolvedValueOnce([])
    await listCredentialGroupEnrollments('workspace-1', 'group-1', 50, undefined, { search: '   ' })
    expect(ilike).not.toHaveBeenCalled()
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

describe('verified self enrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const group = {
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    groupId: 'group-1',
    groupName: 'Connected accounts',
    groupStatus: 'active',
    options: [],
  }

  it('permits a token enrollment in an empty canonical group without sending email', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([group]).mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([ENROLLMENT])
    const result = await createCredentialGroupSelfEnrollmentLink(
      'workspace-1',
      'group-1',
      ENROLLMENT.email
    )
    expect(result.enrollment.id).toBe(ENROLLMENT.id)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: null, email: ENROLLMENT.email })
    )
  })

  it('continues to require an account type for external invitations', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([group]).mockResolvedValueOnce([])
    await expect(
      createCredentialGroupInvitationLink('workspace-1', 'group-1', 'admin', ENROLLMENT.email)
    ).rejects.toThrow('Add an account type')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('refuses a disabled group for self enrollment', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...group, groupStatus: 'disabled' }])
    await expect(
      createCredentialGroupSelfEnrollmentLink('workspace-1', 'group-1', ENROLLMENT.email)
    ).rejects.toThrow('disabled')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not reactivate access revoked while waiting for the lifecycle lock', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([group])
      .mockResolvedValueOnce([ENROLLMENT])
      .mockResolvedValueOnce([{ ...ENROLLMENT, status: 'revoked' }])
    await expect(
      createCredentialGroupSelfEnrollmentLink('workspace-1', 'group-1', ENROLLMENT.email)
    ).rejects.toThrow('Revoked enrollment')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
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
      'Inviter',
      { optionId: 'option-1', providerName: 'Gmail' }
    )

    expect(renderCredentialGroupInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        searchProviderName: 'Gmail',
        invitationLink: expect.stringMatching(/\?optionId=option-1&returnTo=search$/),
      })
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
    queueTableRows(schemaMock.credentialGroupEnrollment, [{ email: ENROLLMENT.email }])
    queueTableRows(schemaMock.credential, [{ id: 'mcp-cg-connection-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([ENROLLMENT])

    const result = await deleteCredentialGroupEnrollment('workspace-1', 'group-1', ENROLLMENT.id)

    expect(result.credentialGroupEnrollment.id).toBe(ENROLLMENT.id)
    expect(result.retiredMcpConnectionIds).toEqual(['mcp-cg-connection-1'])
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

describe('enrollment context for session-authorized or consumed-attempt OAuth', () => {
  const identity = {
    workspaceId: 'workspace-1',
    credentialGroupId: 'group-1',
    enrollmentId: ENROLLMENT.id,
    email: ENROLLMENT.email,
  }
  const row = {
    enrollment: {
      ...ENROLLMENT,
      userId: 'person-1',
      invitationTokenHash: 'rotated-hash',
      invitationExpiresAt: new Date(0),
    },
    groupId: 'group-1',
    groupName: 'Connected accounts',
    groupStatus: 'active',
    options: [{ id: 'option-1', provider: 'gmail', status: 'active' }],
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    workspaceOwnerId: 'owner',
  }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })
  it('resolves pinned identity after invitation rotation or expiry without looking up the old bearer', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [row])
    expect(await getCredentialGroupOAuthContextForEnrollment(identity, 'option-1')).toMatchObject({
      enrollmentId: identity.enrollmentId,
      workspaceId: identity.workspaceId,
      email: identity.email,
      option: { id: 'option-1' },
    })
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.id, identity.enrollmentId)
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.email, identity.email)
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroup.id, identity.credentialGroupId)
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroup.workspaceId, identity.workspaceId)
    expect(eq).not.toHaveBeenCalledWith(
      schemaMock.credentialGroupEnrollment.invitationTokenHash,
      expect.anything()
    )
    queueTableRows(schemaMock.credentialGroupEnrollment, [row])
    expect(
      await getAuthorizedCredentialGroupOAuthContext(
        { ...identity, invitationTokenHash: 'old-hash' },
        'option-1'
      )
    ).toBeNull()
    expect(eq).toHaveBeenCalledWith(
      schemaMock.credentialGroupEnrollment.invitationTokenHash,
      'old-hash'
    )
  })
  it.each([
    { groupStatus: 'disabled' },
    { enrollment: { ...row.enrollment, status: 'revoked' } },
    { enrollment: { ...row.enrollment, status: 'delivery_failed' } },
    { enrollment: { ...row.enrollment, revokedAt: NOW } },
    { options: [] },
    { options: [{ id: 'option-1', provider: 'gmail', status: 'disabled' }] },
  ])('refuses an enrollment or option that is no longer live', async (change) => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [{ ...row, ...change }])
    expect(await getCredentialGroupOAuthContextForEnrollment(identity, 'option-1')).toBeNull()
  })
  it('resolves a consumed MCP attempt against the live linked server without an invitation bearer', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [row])
    queueTableRows(schemaMock.mcpServers, [
      {
        id: 'mcp-server-1',
        name: 'Fireflies',
        url: 'https://api.fireflies.ai/mcp',
        managedConnectorId: 'fireflies',
      },
    ])
    expect(
      await getCredentialGroupMcpOAuthContextForEnrollment(identity, 'mcp-server-1')
    ).toMatchObject({
      enrollmentId: identity.enrollmentId,
      email: identity.email,
      server: { id: 'mcp-server-1' },
    })
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.email, identity.email)
    expect(eq).toHaveBeenCalledWith(schemaMock.mcpServers.id, 'mcp-server-1')
    expect(eq).toHaveBeenCalledWith(schemaMock.mcpServers.workspaceId, identity.workspaceId)
    expect(eq).toHaveBeenCalledWith(
      schemaMock.mcpServers.credentialGroupId,
      identity.credentialGroupId
    )
    expect(eq).toHaveBeenCalledWith(schemaMock.mcpServers.enabled, true)
    expect(eq).toHaveBeenCalledWith(schemaMock.mcpServers.authType, 'oauth')
    expect(isNull).toHaveBeenCalledWith(schemaMock.mcpServers.deletedAt)
    expect(eq).not.toHaveBeenCalledWith(
      schemaMock.credentialGroupEnrollment.invitationTokenHash,
      expect.anything()
    )
  })
  it('denies a consumed MCP attempt after the enrollment is revoked or its linked server is unavailable', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      { ...row, enrollment: { ...row.enrollment, revokedAt: new Date() } },
    ])
    expect(
      await getCredentialGroupMcpOAuthContextForEnrollment(identity, 'mcp-server-1')
    ).toBeNull()
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.mcpServers)
    queueTableRows(schemaMock.credentialGroupEnrollment, [row])
    queueTableRows(schemaMock.mcpServers, [])
    expect(
      await getCredentialGroupMcpOAuthContextForEnrollment(identity, 'mcp-server-1')
    ).toBeNull()
  })
})

describe('organization enrollment bound identity', () => {
  const identity = {
    organizationId: 'organization-1',
    credentialGroupId: 'group-1',
    enrollmentId: ENROLLMENT.id,
    email: ENROLLMENT.email,
    invitationTokenHash: ENROLLMENT.invitationTokenHash,
  }
  const row = {
    enrollment: { ...ENROLLMENT, userId: 'person-1' },
    groupId: 'group-1',
    groupName: 'Accounts',
    groupStatus: 'active',
    options: [
      { id: 'gmail-option', provider: 'gmail', label: 'Gmail', status: 'active', required: false },
    ],
    workspaceId: null,
    organizationId: 'organization-1',
    organizationName: 'Acme',
    workspaceName: null,
    workspaceOwnerId: null,
    inviterName: 'Admin',
  }
  beforeEach(() => {
    resetDbChainMock()
    vi.clearAllMocks()
    vi.mocked(getOrganizationSubscriptionUsable).mockResolvedValue({ plan: 'enterprise' } as never)
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    queueTableRows(schemaMock.credentialGroupEnrollment, [row])
  })
  it('accepts a verified organization member without any workspace', async () => {
    queueTableRows(schemaMock.member, [{ userId: 'member-1' }])
    await expect(
      getAuthorizedCredentialGroupOAuthContext(identity, 'gmail-option')
    ).resolves.toMatchObject({
      organizationId: 'organization-1',
      credentialOwnerId: 'person-1',
      workspaceName: 'Acme',
    })
  })
  it('retains the bound identity when the contributor is not an organization member', async () => {
    queueTableRows(schemaMock.member, [])
    await expect(
      getAuthorizedCredentialGroupOAuthContext(identity, 'gmail-option')
    ).resolves.toMatchObject({ credentialOwnerId: 'person-1' })
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.member)
  })
  it('uses the bound user instead of looking up matching member emails', async () => {
    queueTableRows(schemaMock.member, [{ userId: 'member-1' }, { userId: 'member-2' }])
    await expect(
      getAuthorizedCredentialGroupOAuthContext(identity, 'gmail-option')
    ).resolves.toMatchObject({ credentialOwnerId: 'person-1' })
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.member)
  })
  it('conceals an enrollment from a different asserted organization', async () => {
    queueTableRows(schemaMock.member, [{ userId: 'member-1' }])
    await expect(
      getAuthorizedCredentialGroupOAuthContext(
        { ...identity, organizationId: 'organization-2' },
        'gmail-option'
      )
    ).resolves.toBeNull()
  })
})

describe('verified immutable enrollment identity binding', () => {
  const identity = {
    workspaceId: 'workspace-1',
    credentialGroupId: 'group-1',
    enrollmentId: ENROLLMENT.id,
    email: ENROLLMENT.email,
    invitationTokenHash: ENROLLMENT.invitationTokenHash,
  }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })
  it('binds an invitation once to its verified recipient', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      { enrollment: { ...ENROLLMENT, userId: null }, email: ENROLLMENT.email, verified: true },
    ])
    await bindCredentialGroupEnrollmentUser(identity, 'recipient')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'recipient' })
    )
    expect(isNull).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId)
    expect(eq).toHaveBeenCalledWith(
      schemaMock.credentialGroupEnrollment.invitationTokenHash,
      identity.invitationTokenHash
    )
  })
  it.each([
    { email: 'someone-else@example.com', verified: true },
    { email: ENROLLMENT.email, verified: false },
  ])('rejects a different or unverified recipient', async ({ email, verified }) => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      { enrollment: { ...ENROLLMENT, userId: null }, email, verified },
    ])
    await expect(bindCredentialGroupEnrollmentUser(identity, 'recipient')).rejects.toThrow(
      'verified email'
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('keeps the same bound user after an email change', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollment: { ...ENROLLMENT, userId: 'recipient' },
        email: 'new@example.com',
        verified: true,
      },
    ])
    await expect(bindCredentialGroupEnrollmentUser(identity, 'recipient')).resolves.toBeUndefined()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('never reassigns a bound enrollment to a different user with the old email', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollment: { ...ENROLLMENT, userId: 'recipient' },
        email: ENROLLMENT.email,
        verified: true,
      },
    ])
    await expect(bindCredentialGroupEnrollmentUser(identity, 'new-user')).rejects.toThrow(
      'verified email'
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
