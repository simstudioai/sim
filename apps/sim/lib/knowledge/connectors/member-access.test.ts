/**
 * @vitest-environment node
 */
import { credentialGroup, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireResourcePolicy: vi.fn(),
  writeResourcePolicy: vi.fn(),
  loadBinding: vi.fn(),
  listOptionCredentials: vi.fn(),
  resolveManagedOAuthToken: vi.fn(),
  rejectManagedOAuthToken: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    CREDENTIAL_ACCESSED: 'credential.accessed',
    CREDENTIAL_UPDATED: 'credential.updated',
    CREDENTIAL_GROUP_UPDATED: 'credential_group.updated',
  },
  AuditResourceType: { CREDENTIAL: 'credential', CREDENTIAL_GROUP: 'credential_group' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/lib/resource-policies/repository', async () => {
  class ResourcePolicyNotFoundError extends Error {}
  class ResourcePolicyRevisionConflictError extends Error {}
  return {
    ResourcePolicyNotFoundError,
    ResourcePolicyRevisionConflictError,
    requireResourcePolicy: mocks.requireResourcePolicy,
    writeResourcePolicy: mocks.writeResourcePolicy,
  }
})

vi.mock('@/lib/credential-groups/credentials', () => ({
  loadManagedCredentialGroupBinding: mocks.loadBinding,
  listCredentialGroupOptionCredentialReferences: mocks.listOptionCredentials,
  isManagedCredentialGroupBindingLive: (binding: {
    managedOauthStatus: string
    enrollmentStatus: string
    groupStatus: string
    optionStatus: string | null
  }) =>
    binding.managedOauthStatus === 'active' &&
    (binding.enrollmentStatus === 'in_progress' || binding.enrollmentStatus === 'completed') &&
    binding.groupStatus === 'active' &&
    binding.optionStatus === 'active',
}))

vi.mock('@/lib/credentials/managed-oauth', () => ({
  resolveManagedOAuthToken: mocks.resolveManagedOAuthToken,
  rejectManagedOAuthToken: mocks.rejectManagedOAuthToken,
}))

import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT } from '@/lib/credential-groups/limits'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import {
  assertKnowledgeConnectorCredentialAccess,
  findListingCapViolation,
  grantKnowledgeConnectorCredentialAccess,
  KnowledgeConnectorMemberAccessDeniedError,
  listKnowledgeConnectorMemberCredentials,
  mintKnowledgeConnectorMemberToken,
  rejectKnowledgeConnectorMemberToken,
  revokeKnowledgeConnectorCredentialAccess,
  validateKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/connectors/member-access'
import {
  ResourcePolicyNotFoundError,
  ResourcePolicyRevisionConflictError,
} from '@/lib/resource-policies/repository'

const GROUP_ID = 'group-1'
const BINDING = {
  workspaceId: 'workspace-1',
  credentialGroupId: GROUP_ID,
  credentialGroupOptionId: 'option-drive',
  connectorId: 'connector-1',
}

function storedPolicy(
  revision: number,
  knowledgeConnectorAccess: Array<{ credentialGroupOptionId: string; connectorIds: string[] }>,
  allowedWorkflowIds: string[] = []
) {
  return {
    id: 'policy-1',
    workspaceId: 'workspace-1',
    revision,
    document: compileCredentialGroupWorkflowAccessPolicy({
      credentialGroupId: GROUP_ID,
      allowedWorkflowIds,
      knowledgeConnectorAccess,
    }),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

describe('knowledge connector member access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writeResourcePolicy.mockImplementation(async (input) => ({
      ...storedPolicy(input.expectedRevision + 1, []),
      document: input.document,
    }))
  })

  describe('grant', () => {
    it('adds the connector under its option while keeping workflow access and audits the group', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(
          3,
          [{ credentialGroupOptionId: 'option-drive', connectorIds: ['connector-0'] }],
          ['workflow-1']
        )
      )

      await grantKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')

      expect(mocks.writeResourcePolicy).toHaveBeenCalledTimes(1)
      const written = mocks.writeResourcePolicy.mock.calls[0][0]
      expect(written.expectedRevision).toBe(3)
      expect(written.actorUserId).toBe('admin-1')
      expect(
        written.document.statements.map((statement: { sid: string }) => statement.sid)
      ).toEqual([
        'CredentialGroupActorCredentialAccess',
        'WorkflowCredentialAccess',
        'KnowledgeConnectorCredentialAccess:option-drive',
      ])
      expect(written.document.statements[2].principals).toEqual([
        { type: 'knowledge_connector', connectorId: 'connector-0' },
        { type: 'knowledge_connector', connectorId: 'connector-1' },
      ])
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'credential_group.updated',
          actorId: 'admin-1',
          resourceId: GROUP_ID,
          metadata: expect.objectContaining({
            change: 'granted',
            connectorId: 'connector-1',
            credentialGroupOptionId: 'option-drive',
            revision: 4,
          }),
        })
      )
    })

    it('is idempotent when the connector is already bound to that option', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(3, [
          { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-1'] },
        ])
      )

      await grantKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')

      expect(mocks.writeResourcePolicy).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    })

    it('moves a connector between options rather than binding it twice', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(1, [{ credentialGroupOptionId: 'option-old', connectorIds: ['connector-1'] }])
      )

      await grantKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')

      const written = mocks.writeResourcePolicy.mock.calls[0][0]
      expect(
        written.document.statements.map((statement: { sid: string }) => statement.sid)
      ).toEqual([
        'CredentialGroupActorCredentialAccess',
        'KnowledgeConnectorCredentialAccess:option-drive',
      ])
    })

    it('recomputes from the fresh document after a revision conflict', async () => {
      mocks.requireResourcePolicy
        .mockResolvedValueOnce(storedPolicy(1, []))
        .mockResolvedValueOnce(
          storedPolicy(2, [
            { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-9'] },
          ])
        )
      mocks.writeResourcePolicy
        .mockRejectedValueOnce(new ResourcePolicyRevisionConflictError())
        .mockImplementationOnce(async (input) => ({
          ...storedPolicy(input.expectedRevision + 1, []),
          document: input.document,
        }))

      await grantKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')

      expect(mocks.writeResourcePolicy).toHaveBeenCalledTimes(2)
      const written = mocks.writeResourcePolicy.mock.calls[1][0]
      expect(written.expectedRevision).toBe(2)
      expect(written.document.statements[1].principals).toEqual([
        { type: 'knowledge_connector', connectorId: 'connector-1' },
        { type: 'knowledge_connector', connectorId: 'connector-9' },
      ])
    })

    it('gives up as a conflict when the policy keeps changing', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(storedPolicy(1, []))
      mocks.writeResourcePolicy.mockRejectedValue(new ResourcePolicyRevisionConflictError())

      await expect(
        grantKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')
      ).rejects.toMatchObject({ code: 'conflict' })
    })

    it('refuses to bind more connectors than one option may back', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(1, [
          {
            credentialGroupOptionId: 'option-drive',
            connectorIds: Array.from(
              { length: CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT },
              (_, index) => `connector-${String(index).padStart(3, '0')}`
            ),
          },
        ])
      )

      await expect(
        grantKnowledgeConnectorCredentialAccess(
          { ...BINDING, connectorId: 'connector-new' },
          'admin-1'
        )
      ).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.writeResourcePolicy).not.toHaveBeenCalled()
    })
  })

  describe('revoke', () => {
    it('removes the connector and drops an emptied option statement', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(5, [
          { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-1'] },
          { credentialGroupOptionId: 'option-other', connectorIds: ['connector-2'] },
        ])
      )

      await revokeKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')

      const written = mocks.writeResourcePolicy.mock.calls[0][0]
      expect(
        written.document.statements.map((statement: { sid: string }) => statement.sid)
      ).toEqual([
        'CredentialGroupActorCredentialAccess',
        'KnowledgeConnectorCredentialAccess:option-other',
      ])
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ change: 'revoked' }) })
      )
    })

    it('is a no-op when the connector was never bound', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(storedPolicy(5, []))

      await revokeKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')

      expect(mocks.writeResourcePolicy).not.toHaveBeenCalled()
    })

    it('tolerates a group whose policy is already gone', async () => {
      mocks.requireResourcePolicy.mockRejectedValue(new ResourcePolicyNotFoundError())

      await expect(
        revokeKnowledgeConnectorCredentialAccess(BINDING, 'admin-1')
      ).resolves.toBeUndefined()
    })
  })

  describe('mint', () => {
    const mintInput = {
      connectorId: 'connector-1',
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
      expectedProviderId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive'],
      runId: 'run-1',
    }

    beforeEach(() => {
      mocks.loadBinding.mockResolvedValue({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        providerId: 'google-drive',
        credentialGroupId: GROUP_ID,
        credentialGroupOptionId: 'option-drive',
        managedOauthStatus: 'active',
        enrollmentStatus: 'completed',
        groupStatus: 'active',
        optionStatus: 'active',
      })
      mocks.resolveManagedOAuthToken.mockResolvedValue({ accessToken: 'token', refreshed: false })
    })

    it('resolves the token when the policy names the connector under the credential option and audits it', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(2, [
          { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-1'] },
        ])
      )

      await expect(mintKnowledgeConnectorMemberToken(mintInput)).resolves.toEqual({
        accessToken: 'token',
        refreshed: false,
      })

      expect(mocks.resolveManagedOAuthToken).toHaveBeenCalledWith({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        expectedProviderId: 'google-drive',
        requiredScopes: ['https://www.googleapis.com/auth/drive'],
      })
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'credential.accessed',
          actorId: null,
          resourceId: 'credential-1',
          metadata: expect.objectContaining({
            connectorId: 'connector-1',
            credentialGroupOptionId: 'option-drive',
            runId: 'run-1',
          }),
        })
      )
    })

    it('reports provider rejection only under the current connector grant', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(2, [
          { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-1'] },
        ])
      )
      mocks.rejectManagedOAuthToken.mockResolvedValue(true)
      await expect(
        rejectKnowledgeConnectorMemberToken({ ...mintInput, rejectedAccessToken: 'token' })
      ).resolves.toBe(true)
      expect(mocks.rejectManagedOAuthToken).toHaveBeenCalledWith({
        credentialId: mintInput.credentialId,
        workspaceId: mintInput.workspaceId,
        expectedProviderId: mintInput.expectedProviderId,
        requiredScopes: mintInput.requiredScopes,
        rejectedAccessToken: 'token',
      })
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'credential.updated' })
      )
    })

    it('cannot reject a credential when its connector grant has been removed', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(storedPolicy(2, []))
      await expect(
        rejectKnowledgeConnectorMemberToken({ ...mintInput, rejectedAccessToken: 'token' })
      ).rejects.toBeInstanceOf(KnowledgeConnectorMemberAccessDeniedError)
      expect(mocks.rejectManagedOAuthToken).not.toHaveBeenCalled()
    })

    it('denies a connector the policy does not name', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(2, [
          { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-2'] },
        ])
      )

      await expect(mintKnowledgeConnectorMemberToken(mintInput)).rejects.toBeInstanceOf(
        KnowledgeConnectorMemberAccessDeniedError
      )
      expect(mocks.resolveManagedOAuthToken).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    })

    it('denies a credential collected under a different option', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(2, [
          { credentialGroupOptionId: 'option-other', connectorIds: ['connector-1'] },
        ])
      )

      await expect(mintKnowledgeConnectorMemberToken(mintInput)).rejects.toBeInstanceOf(
        KnowledgeConnectorMemberAccessDeniedError
      )
      expect(mocks.resolveManagedOAuthToken).not.toHaveBeenCalled()
    })

    it.each([
      ['a revoked enrollment', { enrollmentStatus: 'revoked' }],
      ['a disabled option', { optionStatus: 'disabled' }],
      ['a removed option', { optionStatus: null }],
      ['a disabled group', { groupStatus: 'disabled' }],
      ['a credential needing re-auth', { managedOauthStatus: 'needs_reauth' }],
    ] as const)('denies %s before consulting any policy', async (_name, overrides) => {
      mocks.loadBinding.mockResolvedValue({
        credentialId: 'credential-1',
        workspaceId: 'workspace-1',
        providerId: 'google-drive',
        credentialGroupId: GROUP_ID,
        credentialGroupOptionId: 'option-drive',
        managedOauthStatus: 'active',
        enrollmentStatus: 'completed',
        groupStatus: 'active',
        optionStatus: 'active',
        ...overrides,
      })

      await expect(mintKnowledgeConnectorMemberToken(mintInput)).rejects.toBeInstanceOf(
        KnowledgeConnectorMemberAccessDeniedError
      )
      expect(mocks.requireResourcePolicy).not.toHaveBeenCalled()
    })

    it('denies a credential from another workspace before consulting any policy', async () => {
      mocks.loadBinding.mockResolvedValue({
        credentialId: 'credential-1',
        workspaceId: 'workspace-2',
        providerId: 'google-drive',
        credentialGroupId: GROUP_ID,
        credentialGroupOptionId: 'option-drive',
        managedOauthStatus: 'active',
        enrollmentStatus: 'completed',
        groupStatus: 'active',
        optionStatus: 'active',
      })

      await expect(mintKnowledgeConnectorMemberToken(mintInput)).rejects.toBeInstanceOf(
        KnowledgeConnectorMemberAccessDeniedError
      )
      expect(mocks.requireResourcePolicy).not.toHaveBeenCalled()
    })

    it('denies when the group policy no longer exists', async () => {
      mocks.requireResourcePolicy.mockRejectedValue(new ResourcePolicyNotFoundError())

      await expect(mintKnowledgeConnectorMemberToken(mintInput)).rejects.toBeInstanceOf(
        KnowledgeConnectorMemberAccessDeniedError
      )
    })
  })

  describe('list', () => {
    it('pages the option credentials only for a granted connector', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(2, [
          { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-1'] },
        ])
      )
      mocks.listOptionCredentials.mockResolvedValue({ credentials: [], nextCursor: null })

      await listKnowledgeConnectorMemberCredentials({ ...BINDING, limit: 50, cursor: 'c-1' })

      expect(mocks.listOptionCredentials).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        credentialGroupId: GROUP_ID,
        credentialGroupOptionId: 'option-drive',
        limit: 50,
        cursor: 'c-1',
      })
    })

    it('refuses to enumerate members for a connector without a grant', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(storedPolicy(2, []))

      await expect(
        listKnowledgeConnectorMemberCredentials({ ...BINDING, limit: 50 })
      ).rejects.toBeInstanceOf(KnowledgeConnectorMemberAccessDeniedError)
      expect(mocks.listOptionCredentials).not.toHaveBeenCalled()
    })
  })

  describe('binding validation', () => {
    const driveMeta = {
      name: 'Google Drive',
      auth: {
        mode: 'oauth' as const,
        provider: 'google-drive' as const,
        requiredScopes: ['https://www.googleapis.com/auth/drive'],
      },
      permissionScopedListing: { capFieldIds: ['maxFiles'] },
      configFields: [{ id: 'maxFiles', title: 'Max Files', type: 'short-input' as const }],
    }
    const driveOption = {
      id: 'option-drive',
      provider: 'google-drive',
      label: 'Drive',
      authorizationAppId: 'google:app',
      requiredScopes: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      scopeVersion: 1,
      required: true,
      status: 'active' as const,
    }
    const group = { status: 'active' as const, options: [driveOption] }

    it('accepts a matching, fully scoped, uncapped binding', () => {
      expect(
        validateKnowledgeConnectorMembersBinding({
          connectorMeta: driveMeta,
          group,
          credentialGroupOptionId: 'option-drive',
          sourceConfig: { folderId: ['folder-1'], maxFiles: '' },
        })
      ).toEqual({ ok: true, option: driveOption })
    })

    describe('a Slack option, whose members authorize through the workspace custom app', () => {
      const slackMeta = {
        name: 'Slack',
        auth: {
          mode: 'oauth' as const,
          provider: 'slack' as const,
          requiredScopes: ['channels:read', 'channels:history', 'groups:read', 'groups:history'],
        },
        permissionScopedListing: { capFieldIds: ['channel'] },
        configFields: [{ id: 'channel', title: 'Channels', type: 'short-input' as const }],
      }
      const slackOption = {
        ...driveOption,
        id: 'option-slack',
        provider: 'slack',
        label: 'Slack',
        authorizationAppId: 'slack:app',
        requiredScopes: [...SLACK_MANAGED_USER_SCOPES],
      }
      const slackGroup = { status: 'active' as const, options: [slackOption] }

      it('accepts the binding through the Slack scope policy', () => {
        expect(
          validateKnowledgeConnectorMembersBinding({
            connectorMeta: slackMeta,
            group: slackGroup,
            credentialGroupOptionId: 'option-slack',
            sourceConfig: { maxMessages: '500' },
          })
        ).toEqual({ ok: true, option: slackOption })
      })

      it('rejects a channel selection as a listing cap', () => {
        const result = validateKnowledgeConnectorMembersBinding({
          connectorMeta: slackMeta,
          group: slackGroup,
          credentialGroupOptionId: 'option-slack',
          sourceConfig: { channel: ['general'] },
        })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.message).toContain('Channels cannot be set')
      })

      it('rejects an option missing a history scope', () => {
        const result = validateKnowledgeConnectorMembersBinding({
          connectorMeta: slackMeta,
          group: {
            ...slackGroup,
            options: [{ ...slackOption, requiredScopes: ['channels:read', 'groups:read'] }],
          },
          credentialGroupOptionId: 'option-slack',
          sourceConfig: {},
        })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.message).toContain('every permission')
      })
    })

    it.each([
      [
        'a connector whose listing is not permission scoped',
        { connectorMeta: { ...driveMeta, permissionScopedListing: undefined } },
        'cannot sync per member',
      ],
      ['a disabled group', { group: { ...group, status: 'disabled' as const } }, 'is disabled'],
      ['an unknown option', { credentialGroupOptionId: 'option-missing' }, 'was not found'],
      [
        'a disabled option',
        { group: { ...group, options: [{ ...driveOption, status: 'disabled' as const }] } },
        'option is disabled',
      ],
      [
        'an option for another provider',
        { group: { ...group, options: [{ ...driveOption, provider: 'google-calendar' }] } },
        'needs google-drive',
      ],
      [
        'an option missing a required scope',
        {
          group: {
            ...group,
            options: [
              {
                ...driveOption,
                requiredScopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
              },
            ],
          },
        },
        'every permission',
      ],
      ['a listing cap', { sourceConfig: { maxFiles: '500' } }, 'Max Files cannot be set'],
    ])('rejects %s', (_name, overrides, message) => {
      const result = validateKnowledgeConnectorMembersBinding({
        connectorMeta: driveMeta,
        group,
        credentialGroupOptionId: 'option-drive',
        sourceConfig: {},
        ...overrides,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain(message)
    })
  })
})

describe('findListingCapViolation', () => {
  const meta = {
    permissionScopedListing: { capFieldIds: ['maxFiles'] },
    configFields: [{ id: 'maxFiles', title: 'Max Files' }],
  } as never

  it.each([[undefined], [null], [''], ['0'], [0], [' 0 ']])('treats %j as unlimited', (value) => {
    expect(findListingCapViolation(meta, { maxFiles: value })).toBeNull()
  })

  it.each([['5'], [5], ['abc']])('refuses %j', (value) => {
    expect(findListingCapViolation(meta, { maxFiles: value })).toContain('Max Files')
  })
})

describe('organization member credential binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const orgBinding = {
    organizationId: 'org-1',
    credentialGroupId: GROUP_ID,
    credentialGroupOptionId: 'option-drive',
    connectorId: 'connector-1',
  }

  it('uses the canonical organization connector binding without consulting a workspace policy', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'connector-1' }])
    await assertKnowledgeConnectorCredentialAccess(orgBinding)
    expect(mocks.requireResourcePolicy).not.toHaveBeenCalled()
    const predicate = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    for (const column of [
      knowledgeBase.workspaceId,
      credentialGroup.workspaceId,
      knowledgeBase.deletedAt,
      knowledgeConnector.archivedAt,
      knowledgeConnector.deletedAt,
    ]) {
      expect(
        hasMockCondition(
          predicate,
          (condition) => condition.type === 'isNull' && condition.column === column
        )
      ).toBe(true)
    }
    for (const value of ['org-1', 'connector-1', GROUP_ID, 'option-drive', 'members']) {
      expect(
        hasMockCondition(
          predicate,
          (condition) => condition.type === 'eq' && condition.right === value
        )
      ).toBe(true)
    }
    expect(
      hasMockCondition(
        predicate,
        (condition) =>
          condition.type === 'inArray' && condition.column === knowledgeConnector.status
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        predicate,
        (condition) =>
          condition.type === 'ne' &&
          condition.left === knowledgeConnector.memberSyncStatus &&
          condition.right === 'disabled'
      )
    ).toBe(true)
  })

  it('denies a connector whose current canonical owner or option no longer matches', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(assertKnowledgeConnectorCredentialAccess(orgBinding)).rejects.toBeInstanceOf(
      KnowledgeConnectorMemberAccessDeniedError
    )
    expect(mocks.requireResourcePolicy).not.toHaveBeenCalled()
    expect(mocks.resolveManagedOAuthToken).not.toHaveBeenCalled()
  })

  it('rejects a credential in another organization before minting', async () => {
    mocks.loadBinding.mockResolvedValue({ workspaceId: null, organizationId: 'org-other' })
    await expect(
      mintKnowledgeConnectorMemberToken({
        ...orgBinding,
        credentialId: 'credential-1',
        expectedProviderId: 'google-drive',
        requiredScopes: [],
        runId: 'run-1',
      })
    ).rejects.toBeInstanceOf(KnowledgeConnectorMemberAccessDeniedError)
    expect(mocks.resolveManagedOAuthToken).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('mints a live credential with an exact organization owner after checking the connector binding', async () => {
    mocks.loadBinding.mockResolvedValue({
      ...orgBinding,
      workspaceId: null,
      credentialId: 'credential-1',
      managedOauthStatus: 'active',
      enrollmentStatus: 'completed',
      groupStatus: 'active',
      optionStatus: 'active',
    })
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'connector-1' }])
    mocks.resolveManagedOAuthToken.mockResolvedValue({ accessToken: 'opaque-token' })
    await mintKnowledgeConnectorMemberToken({
      ...orgBinding,
      credentialId: 'credential-1',
      expectedProviderId: 'google-drive',
      requiredScopes: [],
      runId: 'run-1',
    })
    expect(mocks.resolveManagedOAuthToken).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      organizationId: 'org-1',
      expectedProviderId: 'google-drive',
      requiredScopes: [],
    })
    expect(mocks.requireResourcePolicy).not.toHaveBeenCalled()
  })
})
