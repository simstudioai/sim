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

const { mockGetPolicy } = vi.hoisted(() => ({
  mockGetPolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => ({ getPolicy: mockGetPolicy }),
}))

import {
  CredentialGroupMcpServerError,
  createCredentialGroup,
  deleteCredentialGroup,
  updateCredentialGroup,
} from '@/lib/credential-groups/service'

describe('Credential Group service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

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
    ).resolves.toMatchObject({ credentialGroup: { id: 'group-1' } })

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

    await expect(
      createCredentialGroup('workspace-1', 'user-1', {
        name: 'Support accounts',
        description: '',
        options: [],
      })
    ).resolves.toMatchObject({ id: 'group-1', workspaceId: 'workspace-1' })
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

    await expect(
      createCredentialGroup('workspace-1', 'user-1', {
        name: 'Support accounts',
        description: '',
        options: [],
      })
    ).rejects.toThrow('Required resource policy is missing')
  })

  it('rejects an OAuth MCP server already held by another Credential Group', async () => {
    const existing = {
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
    queueTableRows(schemaMock.credentialGroup, [existing])
    queueTableRows(schemaMock.mcpServers, [
      {
        id: 'mcp-server-1',
        credentialGroupId: 'group-2',
        authType: 'oauth',
        enabled: true,
        deletedAt: null,
      },
    ])

    await expect(
      updateCredentialGroup('workspace-1', 'group-1', {
        mcpServerIds: ['mcp-server-1'],
      })
    ).rejects.toEqual(
      new CredentialGroupMcpServerError(
        'MCP server mcp-server-1 is already assigned to another Credential Group',
        'conflict'
      )
    )
  })

  it('deletes the policy and group in one locked transaction', async () => {
    queueTableRows(schemaMock.credentialGroup, [{ id: 'group-1' }])
    queueTableRows(schemaMock.credential, [{ id: 'mcp-cg-connection-1' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'policy-1' }])
      .mockResolvedValueOnce([{ id: 'group-1' }])

    await expect(deleteCredentialGroup('workspace-1', 'group-1')).resolves.toEqual({
      deleted: true,
      retiredMcpConnectionIds: ['mcp-cg-connection-1'],
    })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ credentialGroupId: null })
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })
})
