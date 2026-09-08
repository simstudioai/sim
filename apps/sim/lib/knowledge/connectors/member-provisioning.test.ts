/**
 * @vitest-environment node
 */

import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPolicy } = vi.hoisted(() => ({ getPolicy: vi.fn() }))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => ({
    getPolicy,
    hasRequiredScopes: (granted: string[], required: string[]) =>
      required.every((scope) => granted.includes(scope)),
  }),
}))

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
vi.mock('@/lib/credential-groups/organization-setup', () => ({
  requireOrganizationAccountsSetup: vi.fn(),
}))

import type { CredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'
import { inviteCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
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
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import { slackConnectorMeta } from '@/connectors/slack/meta'

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
    vi.mocked(requireOrganizationAccountsSetup).mockReset()
  })

  it('reuses the configured Slack option in the workspace singleton', async () => {
    vi.mocked(ensureWorkspaceAccountsGroup).mockResolvedValue(group([readyOption]) as never)
    await expect(provision(slackMeta)).resolves.toEqual({
      credentialGroupId: 'accounts-1',
      credentialGroupOptionId: 'option-1',
    })
    expect(ensureWorkspaceAccountsGroup).toHaveBeenCalledExactlyOnceWith(
      { kind: 'workspace', workspaceId: 'ws-1' },
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
    expect(ensureWorkspaceAccountsGroup).toHaveBeenCalledExactlyOnceWith(
      { kind: 'workspace', workspaceId: 'ws-1' },
      'user-1',
      {
        provider: 'gmail',
        label: 'Gmail',
        required: false,
      }
    )
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

  it('provisions organization accounts without creating or depending on workspace access', async () => {
    vi.mocked(ensureWorkspaceAccountsGroup).mockResolvedValue(
      group([{ ...readyOption, provider: 'gmail' }]) as never
    )
    await expect(
      provisionKnowledgeConnectorMembersBinding({
        organizationId: 'org-1',
        connectorMeta: gmailMeta,
        userId: 'user-1',
      })
    ).resolves.toEqual({ credentialGroupId: 'accounts-1', credentialGroupOptionId: 'option-1' })
    expect(requireOrganizationAccountsSetup).toHaveBeenCalledWith('org-1', 'accounts-1')
    expect(ensureWorkspaceAccountsGroup).toHaveBeenCalledExactlyOnceWith(
      { kind: 'organization', organizationId: 'org-1' },
      'user-1',
      { provider: 'gmail', label: 'Gmail', required: false }
    )
    expect(inviteCredentialGroupEnrollment).not.toHaveBeenCalled()
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
  const metas = [googleDriveConnectorMeta, slackConnectorMeta, confluenceConnectorMeta]
  const connectors = metas.map((meta) => ({
    id: meta.id,
    connectorType: meta.id,
    accessMode: 'members',
    sourceConfig: {},
    credentialGroupId: 'accounts',
    credentialGroupOptionId: meta.id,
  }))
  const group: CredentialGroupCredentialListContext = {
    credentialGroupId: 'accounts',
    workspaceId: 'workspace',
    name: 'Connected accounts',
    status: 'active',
    options: metas.map((meta) => ({
      id: meta.id,
      provider: meta.auth.mode === 'oauth' ? meta.auth.provider : '',
      label: meta.name,
      status: 'active',
      authorizationAppId: `${meta.id}-app`,
      requiredScopes: meta.auth.mode === 'oauth' ? [...(meta.auth.requiredScopes ?? [])] : [],
      scopeVersion: 1,
      required: false,
    })),
  }
  const resolve = (sources = connectors) =>
    resolveViewerConnectorMemberships({
      userId: 'viewer',
      workspaceId: 'workspace',
      connectors: sources,
    })
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    getPolicy.mockReset().mockResolvedValue(undefined)
    vi.mocked(isKnowledgeMemberAccessAvailable).mockResolvedValue(true)
    queueTableRows(schemaMock.credentialGroup, [group])
    queueTableRows(schemaMock.user, [{ email: 'viewer@example.com', emailVerified: true }])
  })

  it('keeps each provider status independent within the same enrollment', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollmentStatus: 'completed',
        credentialGroupOptionId: 'google_drive',
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
      google_drive: 'connected',
      slack: 'needs_reauth',
      confluence: 'invited',
    })
  })

  it('applies an enrollment revocation to every provider even when a credential remains active', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [
      {
        enrollmentStatus: 'revoked',
        credentialGroupOptionId: 'google_drive',
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

  it.each([
    ['disabled group', { ...group, status: 'disabled' }],
    ['wrong workspace', { ...group, workspaceId: 'another-workspace' }],
    ['missing group', null],
  ])('does not offer a connection through a %s', async (_label, current) => {
    resetDbChainMock()
    queueTableRows(schemaMock.credentialGroup, current ? [current] : [])
    expect(await resolve()).toEqual(new Map())
    expect(getPolicy).not.toHaveBeenCalled()
  })

  it.each([
    ['missing option', []],
    ['disabled option', [{ ...group.options[0]!, status: 'disabled' }]],
    ['wrong provider', [{ ...group.options[0]!, provider: 'confluence' }]],
    ['missing required permissions', [{ ...group.options[0]!, requiredScopes: [] }]],
  ])('does not offer Drive enrollment through a %s', async (_label, options) => {
    resetDbChainMock()
    queueTableRows(schemaMock.credentialGroup, [{ ...group, options }])
    expect(await resolve([connectors[0]!])).toEqual(new Map())
    expect(getPolicy).not.toHaveBeenCalled()
  })

  it('refuses a stale stored group binding instead of borrowing the current workspace group', async () => {
    expect(await resolve([{ ...connectors[0]!, credentialGroupId: 'previous-accounts' }])).toEqual(
      new Map()
    )
    expect(getPolicy).not.toHaveBeenCalled()
  })

  it('does not offer enrollment when the source configuration fails the same member-binding validation', async () => {
    expect(await resolve([{ ...connectors[0]!, sourceConfig: { maxFiles: 10 } }])).toEqual(
      new Map()
    )
    expect(getPolicy).not.toHaveBeenCalled()
  })

  it('checks provider readiness once per option even when many sources share that option', async () => {
    queueTableRows(schemaMock.credentialGroupEnrollment, [])
    const sources = [connectors[0]!, { ...connectors[0]!, id: 'another-drive-source' }]
    expect(await resolve(sources)).toEqual(
      new Map([
        ['google_drive', 'not_enrolled'],
        ['another-drive-source', 'not_enrolled'],
      ])
    )
    expect(getPolicy).toHaveBeenCalledExactlyOnceWith(group.options[0], {
      workspaceId: 'workspace',
      credentialGroupId: 'accounts',
      credentialGroupOptionId: 'google_drive',
    })
  })

  it('suppresses an unavailable Slack app while preserving another provider connection', async () => {
    getPolicy.mockImplementation(async (option: { provider: string }) => {
      if (option.provider === 'slack') {
        throw new CredentialGroupProviderConfigurationError('The custom Slack bot is unavailable')
      }
    })
    queueTableRows(schemaMock.credentialGroupEnrollment, [])
    expect(await resolve()).toEqual(
      new Map([
        ['google_drive', 'not_enrolled'],
        ['confluence', 'not_enrolled'],
      ])
    )
  })

  it('does not disguise a provider configuration read failure as missing admin setup', async () => {
    getPolicy.mockRejectedValue(new Error('Database unavailable'))
    await expect(resolve()).rejects.toThrow('Database unavailable')
  })

  it('still requires a verified email after a live binding has been resolved', async () => {
    resetDbChainMock()
    queueTableRows(schemaMock.credentialGroup, [group])
    queueTableRows(schemaMock.user, [{ email: 'viewer@example.com', emailVerified: false }])
    queueTableRows(schemaMock.credentialGroupEnrollment, [])
    expect([...(await resolve()).values()]).toEqual([
      'unverified_email',
      'unverified_email',
      'unverified_email',
    ])
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
    sourceConfig: {},
    credentialGroupId: null,
    credentialGroupOptionId: null,
  }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    getPolicy.mockReset().mockResolvedValue(undefined)
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

  it('does not offer an identity connection when the configured OAuth client is unavailable', async () => {
    queueTableRows(schemaMock.credentialGroup, [group])
    getPolicy.mockRejectedValue(
      new CredentialGroupProviderConfigurationError(
        'Managed Confluence authorization is not configured'
      )
    )
    expect(
      await resolveViewerConnectorMemberships({
        userId: 'viewer',
        workspaceId: 'workspace',
        connectors: [connector],
      })
    ).toEqual(new Map())
  })
})
