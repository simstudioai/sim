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
} from '@/lib/knowledge/connectors/member-provisioning'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import { slackConnectorMeta } from '@/connectors/slack/meta'

describe('provisionKnowledgeConnectorMembersBinding', () => {
  const slackMeta = { name: 'Slack', auth: { mode: 'oauth' as const, provider: 'slack' } }
  const _gmailMeta = { name: 'Gmail', auth: { mode: 'oauth' as const, provider: 'google-email' } }
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
    resetDbChainMock()
    getPolicy.mockReset().mockResolvedValue(undefined)
    vi.mocked(isKnowledgeMemberAccessAvailable).mockResolvedValue(true)
    queueTableRows(schemaMock.credentialGroup, [group])
    queueTableRows(schemaMock.user, [{ email: 'viewer@example.com', emailVerified: true }])
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

  it('refuses a stale stored group binding instead of borrowing the current workspace group', async () => {
    expect(await resolve([{ ...connectors[0]!, credentialGroupId: 'previous-accounts' }])).toEqual(
      new Map()
    )
    expect(getPolicy).not.toHaveBeenCalled()
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
  const _group: CredentialGroupCredentialListContext = {
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
    resetDbChainMock()
    getPolicy.mockReset().mockResolvedValue(undefined)
    vi.mocked(isKnowledgeMemberAccessAvailable).mockResolvedValue(true)
    vi.mocked(resolveKnowledgeAccessAvailability).mockResolvedValue({
      memberScoped: true,
      sourceMirrored: true,
    })
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
