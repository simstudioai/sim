/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPolicy, mockConfiguration } = vi.hoisted(() => ({
  mockGetPolicy: vi.fn(),
  mockConfiguration: vi.fn(),
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => ({ getPolicy: mockGetPolicy }),
}))
vi.mock('@/lib/credential-groups/provider-configuration', () => ({
  decryptCredentialGroupProviderConfiguration: mockConfiguration,
}))

import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  ensureWorkspaceAccountsGroup,
  getCredentialGroup,
  updateCredentialGroup,
} from '@/lib/credential-groups/service'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'

describe('Credential Group service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockConfiguration.mockResolvedValue({})
  })

  it.each([
    {
      name: 'minimal search ready',
      required: SLACK_SEARCH_USER_SCOPES,
      granted: SLACK_SEARCH_USER_SCOPES,
      expected: 'ready',
    },
    {
      name: 'workflow ready',
      required: SLACK_MANAGED_USER_SCOPES,
      granted: SLACK_MANAGED_USER_SCOPES,
      expected: 'ready',
    },
    {
      name: 'workflow needs additional consent',
      required: SLACK_MANAGED_USER_SCOPES,
      granted: SLACK_SEARCH_USER_SCOPES,
      expected: 'needs_update',
    },
    {
      name: 'search missing history',
      required: SLACK_SEARCH_USER_SCOPES,
      granted: SLACK_SEARCH_USER_SCOPES.filter((scope) => scope !== 'groups:history'),
      expected: 'needs_update',
    },
  ])(
    'projects configuration status from the canonical option policy: $name',
    async ({ required, granted, expected }) => {
      const now = new Date('2026-09-04T00:00:00Z')
      queueTableRows(schemaMock.credentialGroup, [
        {
          id: 'group-1',
          workspaceId: 'workspace-1',
          name: 'Members',
          description: null,
          options: [
            {
              id: 'option-1',
              label: 'Slack',
              provider: 'slack',
              slackBotCredentialId: 'bot-1',
              required: false,
              status: 'active',
              requiredScopes: [...required],
              scopeVersion: credentialGroupScopePolicyVersion([...required]),
            },
          ],
          encryptedProviderConfiguration: 'encrypted',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
      ])
      queueTableRows(schemaMock.mcpServers, [])
      mockConfiguration.mockResolvedValue({
        slack: { slackBotCredentialId: 'bot-1', scopes: [...granted] },
      })
      const result = await getCredentialGroup('workspace-1', 'group-1')
      expect(result?.options[0]).toMatchObject({
        configurationStatus: expected,
        requiredScopes: [...required],
      })
    }
  )

  it('validates provider policy through the active update transaction', async () => {
    const option = {
      id: 'option-1',
      provider: 'slack' as const,
      label: 'Slack',
      slackBotCredentialId: 'bot-1',
      authorizationAppId: 'slack:A123:T123',
      requiredScopes: ['chat:write'],
      scopeVersion: 1,
      required: true,
      status: 'active' as const,
    }
    const existing = {
      id: 'group-1',
      workspaceId: 'workspace-1',
      publicId: 'public-1',
      name: 'Support accounts',
      description: null,
      options: [option],
      encryptedProviderConfiguration: null,
      status: 'active' as const,
      createdBy: 'user-1',
      createdAt: new Date('2026-08-13T00:00:00Z'),
      updatedAt: new Date('2026-08-13T00:00:00Z'),
    }
    queueTableRows(schemaMock.credentialGroup, [existing])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...existing, updatedAt: new Date('2026-08-13T01:00:00Z') },
    ])
    mockGetPolicy.mockResolvedValue({
      provider: 'slack',
      providerId: 'slack',
      authorizationAppId: option.authorizationAppId,
      requiredScopes: option.requiredScopes,
      scopeVersion: option.scopeVersion,
    })

    await expect(
      updateCredentialGroup('workspace-1', 'group-1', {
        options: [
          {
            id: option.id,
            provider: option.provider,
            label: option.label,
            slackBotCredentialId: option.slackBotCredentialId,
            required: option.required,
          },
        ],
      })
    ).resolves.toMatchObject({ id: 'group-1' })

    expect(mockGetPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ slackBotCredentialId: 'bot-1' }),
      {
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        executor: dbChainMock.db,
      }
    )
  })

  it('creates a group only when its trigger-created default policy is present', async () => {
    const created = {
      id: 'group-1',
      workspaceId: 'workspace-1',
      publicId: 'public-1',
      name: 'Support accounts',
      description: null,
      options: [],
      encryptedProviderConfiguration: null,
      status: 'active' as const,
      createdBy: 'user-1',
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    }
    dbChainMockFns.returning.mockResolvedValueOnce([created])
    queueTableRows(schemaMock.resourcePolicy, [
      {
        id: 'policy-1',
        workspaceId: 'workspace-1',
        resourceType: 'credential_group',
        resourceId: 'group-1',
        revision: 1,
        document: {
          version: 1,
          resource: { type: 'credential_group', id: 'group-1' },
          statements: [
            {
              sid: 'CredentialGroupActorCredentialAccess',
              effect: 'allow',
              actions: ['credential_groups.credentials.use'],
              principals: [{ type: 'credential_group_actor' }],
              condition: {
                Bool: { 'credential_group:ActorOwnsCredential': true },
              },
            },
          ],
        },
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    ])

    await expect(ensureWorkspaceAccountsGroup('workspace-1', 'user-1')).resolves.toMatchObject({
      id: 'group-1',
      workspaceId: 'workspace-1',
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it('rolls back group creation when the required policy is missing', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'group-1',
        workspaceId: 'workspace-1',
        publicId: 'public-1',
        name: 'Support accounts',
        description: null,
        options: [],
        encryptedProviderConfiguration: null,
        status: 'active',
        createdBy: 'user-1',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])

    await expect(ensureWorkspaceAccountsGroup('workspace-1', 'user-1')).rejects.toThrow(
      'Required resource policy is missing'
    )
  })

  it('reuses the existing workspace container without inserting or renaming it', async () => {
    queueTableRows(schemaMock.credentialGroup, [
      {
        id: 'group-1',
        workspaceId: 'workspace-1',
        name: 'Existing accounts',
        description: null,
        options: [],
        encryptedProviderConfiguration: null,
        status: 'active',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])
    await expect(ensureWorkspaceAccountsGroup('workspace-1', 'user-1')).resolves.toMatchObject({
      id: 'group-1',
      created: false,
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
