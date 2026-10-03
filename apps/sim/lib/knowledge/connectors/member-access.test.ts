import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  credentialsManagedOauthMock,
  credentialsManagedOauthMockFns,
} from '@sim/testing/mocks/credentials-managed-oauth.mock'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)

vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)

vi.mock('@/lib/credentials/managed-oauth', () => credentialsManagedOauthMock)

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
  validateKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/connectors/member-access'
import { ResourcePolicyRevisionConflictError } from '@/lib/resource-policies/repository'

const mocks = {
  requireResourcePolicy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
  writeResourcePolicy: resourcePolicyRepositoryMockFns.mockWriteResourcePolicy,
  loadBinding: credentialGroupsCredentialsMockFns.mockLoadManagedCredentialGroupBinding,
  listOptionCredentials:
    credentialGroupsCredentialsMockFns.mockListCredentialGroupOptionCredentialReferences,
  resolveManagedOAuthToken: credentialsManagedOauthMockFns.mockResolveManagedOAuthToken,
  rejectManagedOAuthToken: credentialsManagedOauthMockFns.mockRejectManagedOAuthToken,
}

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
    mocks.writeResourcePolicy.mockImplementation(async (input) => ({
      ...storedPolicy(input.expectedRevision + 1, []),
      document: input.document,
    }))
  })

  describe('grant', () => {
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

    it('refuses a removed connector even while its policy grant remains', async () => {
      mocks.requireResourcePolicy.mockResolvedValue(
        storedPolicy(2, [
          { credentialGroupOptionId: 'option-drive', connectorIds: ['connector-1'] },
        ])
      )

      await expect(mintKnowledgeConnectorMemberToken(mintInput)).rejects.toThrow(
        'Knowledge connector has been removed'
      )
      expect(mocks.resolveManagedOAuthToken).not.toHaveBeenCalled()
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
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
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
  })

  describe('list', () => {
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
    resetDbChainMock()
  })

  const orgBinding = {
    organizationId: 'org-1',
    credentialGroupId: GROUP_ID,
    credentialGroupOptionId: 'option-drive',
    connectorId: 'connector-1',
  }

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
})
