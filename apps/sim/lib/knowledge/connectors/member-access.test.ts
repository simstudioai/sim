/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireResourcePolicy: vi.fn(),
  writeResourcePolicy: vi.fn(),
  loadBinding: vi.fn(),
  listOptionCredentials: vi.fn(),
  resolveManagedOAuthToken: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    CREDENTIAL_ACCESSED: 'credential.accessed',
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
}))

import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT } from '@/lib/credential-groups/limits'
import {
  findListingCapViolation,
  grantKnowledgeConnectorCredentialAccess,
  KnowledgeConnectorMemberAccessDeniedError,
  listKnowledgeConnectorMemberCredentials,
  mintKnowledgeConnectorMemberToken,
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
