/**
 * @vitest-environment node
 */

import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/enrollments', () => ({
  createCredentialGroupInvitationLink: vi.fn(),
  inviteCredentialGroupEnrollment: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: vi.fn(),
  resolveKnowledgeAccessAvailability: vi.fn(),
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({ dispatchMemberSync: vi.fn() }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  ensureWorkspaceAccountsGroup: vi.fn(),
}))

import type { CredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'
import { inviteCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import {
  isKnowledgeMemberAccessAvailable,
  resolveKnowledgeAccessAvailability,
} from '@/lib/knowledge/access/availability'
import {
  deriveViewerConnectorMembership,
  inviteWorkspaceMembersToCredentialGroup,
  provisionKnowledgeConnectorMembersBinding,
  resolveViewerConnectorMemberships,
  sourceIdentityBinding,
} from '@/lib/knowledge/connectors/member-provisioning'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'

describe('provisionKnowledgeConnectorMembersBinding', () => {
  const slackMeta = { name: 'Slack', auth: { mode: 'oauth' as const, provider: 'slack' } }
  const gmailMeta = { name: 'Gmail', auth: { mode: 'oauth' as const, provider: 'google-email' } }
  const readyOption = {
    id: 'option-1',
    provider: 'slack',
    status: 'active',
    configurationStatus: 'ready',
  }
  const group = (options: unknown[]) => ({
    id: 'accounts-1',
    name: 'Connected accounts',
    status: 'active',
    options,
  })
  const provision = (meta: typeof slackMeta) =>
    provisionKnowledgeConnectorMembersBinding({
      workspaceId: 'ws-1',
      connectorMeta: meta,
      userId: 'user-1',
    })
  beforeEach(() => {
    vi.mocked(ensureWorkspaceAccountsGroup).mockReset()
  })

  it('reuses the configured Slack option in the workspace singleton', async () => {
    vi.mocked(ensureWorkspaceAccountsGroup).mockResolvedValue(group([readyOption]) as never)
    await expect(provision(slackMeta)).resolves.toEqual({
      credentialGroupId: 'accounts-1',
      credentialGroupOptionId: 'option-1',
    })
    expect(ensureWorkspaceAccountsGroup).toHaveBeenCalledExactlyOnceWith(
      'ws-1',
      'user-1',
      undefined
    )
  })

  it('adds standard OAuth accounts to the same singleton for any members-mode connector', async () => {
    vi.mocked(ensureWorkspaceAccountsGroup).mockResolvedValue(
      group([{ ...readyOption, provider: 'gmail' }]) as never
    )
    await expect(provision(gmailMeta)).resolves.toEqual({
      credentialGroupId: 'accounts-1',
      credentialGroupOptionId: 'option-1',
    })
    expect(ensureWorkspaceAccountsGroup).toHaveBeenCalledExactlyOnceWith('ws-1', 'user-1', {
      provider: 'gmail',
      label: 'Gmail',
      required: false,
    })
  })

  it.each([
    [],
    [{ ...readyOption, configurationStatus: 'not_configured' }],
    [{ ...readyOption, status: 'disabled' }],
    [readyOption, { ...readyOption, id: 'option-2' }],
  ])(
    'requires one ready Slack option instead of guessing or creating another group (%j)',
    async (...options) => {
      vi.mocked(ensureWorkspaceAccountsGroup).mockResolvedValue(group(options) as never)
      await expect(provision(slackMeta)).rejects.toThrow(
        'Configure Slack member sign-in in Connected accounts in Settings'
      )
    }
  )

  it('propagates an unavailable singleton instead of creating a replacement', async () => {
    vi.mocked(ensureWorkspaceAccountsGroup).mockRejectedValue(
      new Error('Connected accounts is disabled')
    )
    await expect(provision(gmailMeta)).rejects.toThrow('Connected accounts is disabled')
    expect(ensureWorkspaceAccountsGroup).toHaveBeenCalledOnce()
  })

  it('refuses non-OAuth connectors before provisioning', async () => {
    await expect(
      provisionKnowledgeConnectorMembersBinding({
        workspaceId: 'ws-1',
        connectorMeta: { name: 'API source', auth: { mode: 'apiKey' } },
        userId: 'user-1',
      })
    ).rejects.toThrow('Only an OAuth connector')
    expect(ensureWorkspaceAccountsGroup).not.toHaveBeenCalled()
  })
})

describe('bounded workspace invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.mocked(inviteCredentialGroupEnrollment).mockResolvedValue({} as never)
    queueTableRows(schemaMock.workspace, [{ organizationId: 'organization' }])
  })

  it('invites bounded pages and advances past a failed invite without reactivating enrollments', async () => {
    queueTableRows(
      schemaMock.user,
      Array.from({ length: 25 }, (_, i) => ({ id: `user-${i}`, email: `person-${i}@example.com` }))
    )
    queueTableRows(schemaMock.user, [{ id: 'user-last', email: 'last@example.com' }])
    vi.mocked(inviteCredentialGroupEnrollment).mockRejectedValueOnce(
      new Error('Invitation rejected')
    )
    const beforeBatch = vi.fn(async () => undefined)
    expect(
      await inviteWorkspaceMembersToCredentialGroup({
        workspaceId: 'workspace',
        credentialGroupId: 'group',
        beforeBatch,
      })
    ).toEqual({ invited: 25, failed: 1 })
    expect(beforeBatch).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(25)
    expect(
      vi.mocked(inviteCredentialGroupEnrollment).mock.calls.every((call) => call[5] === 'reject')
    ).toBe(true)
    expect(inviteCredentialGroupEnrollment).toHaveBeenLastCalledWith(
      'workspace',
      'group',
      undefined,
      undefined,
      'last@example.com',
      'reject'
    )
  })

  it('stops at the job deadline before fetching or sending invitations', async () => {
    const beforeBatch = vi.fn(async () => undefined)
    expect(
      await inviteWorkspaceMembersToCredentialGroup({
        workspaceId: 'workspace',
        credentialGroupId: 'group',
        beforeBatch,
        deadlineAt: Date.now() - 1,
      })
    ).toEqual({ invited: 0, failed: 0 })
    expect(beforeBatch).not.toHaveBeenCalled()
    expect(inviteCredentialGroupEnrollment).not.toHaveBeenCalled()
  })
})

describe('deriveViewerConnectorMembership', () => {
  it.each([
    [true, 'active', 'completed', 'connected'],
    [true, 'active', 'in_progress', 'connected'],
    [true, 'needs_reauth', 'completed', 'needs_reauth'],
    [true, null, 'invited', 'invited'],
    [true, null, 'delivery_failed', 'invited'],
    [true, null, 'in_progress', 'invited'],
    [true, null, 'completed', 'invited'],
    [true, 'revoked', 'completed', 'invited'],
    [true, 'active', 'revoked', 'revoked'],
    [true, null, 'revoked', 'revoked'],
    [true, null, null, 'not_enrolled'],
    [false, 'active', 'completed', 'unverified_email'],
  ] as const)(
    'verified %s + credential %s + enrollment %s → %s',
    (emailVerified, managedOauthStatus, enrollmentStatus, expected) => {
      expect(
        deriveViewerConnectorMembership({ emailVerified, managedOauthStatus, enrollmentStatus })
      ).toBe(expected)
    }
  )
})

describe('viewer account status within the workspace container', () => {
  const connectors = ['drive', 'slack', 'confluence'].map((id) => ({
    id,
    accessMode: 'members',
    credentialGroupId: 'accounts',
    credentialGroupOptionId: id,
  }))
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.mocked(isKnowledgeMemberAccessAvailable).mockResolvedValue(true)
    queueTableRows(schemaMock.user, [{ email: 'viewer@example.com', emailVerified: true }])
  })

  it('keeps each provider status independent within the same enrollment', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollmentStatus: 'completed',
        credentialGroupOptionId: 'drive',
        managedOauthStatus: 'active',
      },
      {
        enrollmentStatus: 'completed',
        credentialGroupOptionId: 'slack',
        managedOauthStatus: 'needs_reauth',
      },
    ])
    const statuses = await resolveViewerConnectorMemberships({
      userId: 'viewer',
      workspaceId: 'workspace',
      connectors,
    })
    expect(Object.fromEntries(statuses)).toEqual({
      drive: 'connected',
      slack: 'needs_reauth',
      confluence: 'invited',
    })
  })

  it('applies an enrollment revocation to every provider even when a credential remains active', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollmentStatus: 'revoked',
        credentialGroupOptionId: 'drive',
        managedOauthStatus: 'active',
      },
    ])
    const statuses = await resolveViewerConnectorMemberships({
      userId: 'viewer',
      workspaceId: 'workspace',
      connectors,
    })
    expect([...statuses.values()]).toEqual(['revoked', 'revoked', 'revoked'])
  })
})

describe('mirrored source account identity', () => {
  const group: CredentialGroupCredentialListContext = {
    credentialGroupId: 'accounts',
    workspaceId: 'workspace',
    name: 'Connected accounts',
    status: 'active',
    options: [
      {
        id: 'confluence',
        provider: 'confluence',
        label: 'Confluence',
        status: 'active',
        authorizationAppId: 'confluence-app',
        requiredScopes: ['read:me'],
        scopeVersion: 1,
        required: false,
      },
    ],
  }
  const connector = {
    id: 'admin-source',
    connectorType: 'confluence',
    accessMode: 'admin',
    credentialGroupId: null,
    credentialGroupOptionId: null,
  }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.mocked(isKnowledgeMemberAccessAvailable).mockResolvedValue(true)
    vi.mocked(resolveKnowledgeAccessAvailability).mockResolvedValue({
      memberScoped: true,
      sourceMirrored: true,
    })
  })

  it('uses the exact configured provider option without requiring content-listing scopes or caps', () => {
    expect(sourceIdentityBinding(confluenceConnectorMeta, group)).toEqual({
      credentialGroupId: 'accounts',
      credentialGroupOptionId: 'confluence',
    })
    expect(
      sourceIdentityBinding(
        { ...confluenceConnectorMeta, requiresMemberIdentity: undefined },
        group
      )
    ).toBeNull()
    expect(
      sourceIdentityBinding({ ...confluenceConnectorMeta, mirrorsSourceAcls: undefined }, group)
    ).toBeNull()
  })

  it('refuses disabled, absent, ambiguous, or different-provider options', () => {
    expect(sourceIdentityBinding(confluenceConnectorMeta, null)).toBeNull()
    expect(
      sourceIdentityBinding(confluenceConnectorMeta, { ...group, status: 'disabled' })
    ).toBeNull()
    for (const options of [
      [],
      [{ ...group.options[0]!, status: 'disabled' as const }],
      [{ ...group.options[0]!, provider: 'jira' }],
      [...group.options, { ...group.options[0]!, id: 'duplicate' }],
    ]) {
      expect(sourceIdentityBinding(confluenceConnectorMeta, { ...group, options })).toBeNull()
    }
  })

  it('offers a reader their own status for a paused admin source without requiring a crawler binding', async () => {
    queueTableRows(schemaMock.credentialGroup, [group])
    queueTableRows(schemaMock.user, [{ email: 'viewer@example.com', emailVerified: true }])
    queueTableRows(schemaMock.credentialGroupEnrollment, [])
    expect(
      await resolveViewerConnectorMemberships({
        userId: 'viewer',
        workspaceId: 'workspace',
        connectors: [connector],
      })
    ).toEqual(new Map([['admin-source', 'not_enrolled']]))
  })

  it('does not offer identity enrollment when source mirroring is unavailable', async () => {
    vi.mocked(resolveKnowledgeAccessAvailability).mockResolvedValue({
      memberScoped: true,
      sourceMirrored: false,
    })
    expect(
      await resolveViewerConnectorMemberships({
        userId: 'viewer',
        workspaceId: 'workspace',
        connectors: [connector],
      })
    ).toEqual(new Map())
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
