/**
 * @vitest-environment node
 */
import type {
  DelegatedPrincipal,
  PersonalApiKeyPrincipal,
  SessionPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  resolvePermissionGroupConfig: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => ({
  resolvePermissionGroupConfig: mocks.resolvePermissionGroupConfig,
}))

import {
  authorizeWorkspaceOperation,
  defineWorkspaceOperation,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PermissionGroupCapabilityError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const writeOperation = defineWorkspaceOperation({
  id: 'test.write',
  minimumRole: 'write',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
})

const principal: SessionPrincipal = {
  kind: 'session',
  userId: 'user-1',
  sessionId: 'session-1',
}

const workspaceKeyOperation = defineWorkspaceOperation({
  id: 'test.workspace-key-write',
  minimumRole: 'write',
  workspaceApiKey: 'allow',
  principalKinds: ['workspace_api_key'],
})

const workspaceKeyPrincipal: WorkspaceApiKeyPrincipal = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-other',
  keyId: 'key-1',
}

const executorOperation = defineWorkspaceOperation({
  id: 'test.executor-write',
  minimumRole: 'write',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
})

function executorPrincipal(
  originalPrincipal: NonNullable<DelegatedPrincipal['delegationContext']>['principal'],
  currentWorkflow?: NonNullable<DelegatedPrincipal['delegationContext']>['currentWorkflow']
): DelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:test',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    resourceScope: { executionId: 'execution-1' },
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'root-workflow-1',
      principal: originalPrincipal,
      ...(currentWorkflow ? { currentWorkflow } : {}),
    },
  }
}

const executorAuthorization = {
  delegation: {
    audience: 'sim:test',
    isWithinScope: () => true,
  },
}

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
}

describe('authorizeWorkspaceOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a null effective permission as no workspace access', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      authorizeWorkspaceOperation(principal, writeOperation, context)
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
  })

  it('rejects a readable workspace as an insufficient role for a write operation', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      authorizeWorkspaceOperation(principal, writeOperation, context)
    ).rejects.toBeInstanceOf(InsufficientWorkspacePermissionsError)
  })

  it('authorizes the write operation when the current role satisfies it', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    await expect(
      authorizeWorkspaceOperation(principal, writeOperation, context)
    ).resolves.toBeUndefined()
  })

  it('classifies a workspace-key tenant mismatch separately from role denials', async () => {
    await expect(
      authorizeWorkspaceOperation(workspaceKeyPrincipal, workspaceKeyOperation, context)
    ).rejects.toBeInstanceOf(WorkspaceApiKeyScopeAuthorizationError)
  })

  /**
   * An operation that denies workspace keys necessarily omits
   * `workspace_api_key` from `principalKinds`, so the kind guard is the only
   * place this refusal can be raised. Reported as a generic kind refusal, the
   * published `WORKSPACE_KEY_OPERATION_NOT_PERMITTED` code is unmatchable by any
   * client.
   */
  it('names a workspace key refused by an operation that denies workspace keys', async () => {
    await expect(
      authorizeWorkspaceOperation(
        { ...workspaceKeyPrincipal, workspaceId: context.workspaceId },
        writeOperation,
        context
      )
    ).rejects.toBeInstanceOf(WorkspaceApiKeyAuthorizationError)
  })

  it('still reports another disallowed principal kind as a kind refusal', async () => {
    await expect(
      authorizeWorkspaceOperation(principal, workspaceKeyOperation, context)
    ).rejects.toBeInstanceOf(PrincipalKindAuthorizationError)
  })

  it.each([
    {
      name: 'generic webhook',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-1',
        workflowId: 'root-workflow-1',
        webhookId: 'webhook-1',
        provider: 'generic',
      },
    },
    {
      name: 'Slack webhook',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-1',
        workflowId: 'root-workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user' as const,
          provider: 'slack',
          tenantId: 'tenant-1',
          subjectId: 'subject-1',
        },
      },
    },
    {
      name: 'schedule',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'root-workflow-1',
      },
    },
  ])('authorizes a $name by its bound deployed workflow', async ({ principal }) => {
    await expect(
      authorizeWorkspaceOperation(
        executorPrincipal(principal, {
          workflowId: 'current-workflow-1',
          mode: 'deployment',
          deploymentVersionId: 'deployment-1',
        }),
        executorOperation,
        context,
        executorAuthorization
      )
    ).resolves.toBeUndefined()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing', currentWorkflow: undefined },
    {
      name: 'draft',
      currentWorkflow: { workflowId: 'current-workflow-1', mode: 'draft' as const },
    },
  ])('rejects actorless execution with a $name workflow authority', async ({ currentWorkflow }) => {
    await expect(
      authorizeWorkspaceOperation(
        executorPrincipal(
          {
            kind: 'system',
            serviceId: 'webhook',
            workspaceId: 'workspace-1',
            workflowId: 'root-workflow-1',
            webhookId: 'webhook-1',
            provider: 'generic',
          },
          currentWorkflow
        ),
        executorOperation,
        context,
        executorAuthorization
      )
    ).rejects.toMatchObject({ name: 'DelegatedWorkspaceAuthorizationError' })
  })

  it('keeps a real human execution on the human workspace-role path in draft mode', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    await expect(
      authorizeWorkspaceOperation(
        {
          ...executorPrincipal(
            { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            { workflowId: 'current-workflow-1', mode: 'draft' }
          ),
          subjectUserId: 'user-1',
        },
        executorOperation,
        context,
        executorAuthorization
      )
    ).resolves.toBeUndefined()
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
  })
})

const capabilityOperation = defineWorkspaceOperation({
  id: 'test.capability-read',
  minimumRole: 'read',
  workspaceApiKey: 'allow',
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['executor'],
  capability: 'tables.use',
})

const personalKeyPrincipal: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-personal-1',
}

const scopedWorkspaceKeyPrincipal: WorkspaceApiKeyPrincipal = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-1',
  keyId: 'key-1',
}

/** A config that withholds the capability the operation above declares. */
function withholdingConfig() {
  return { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideTablesTab: true }
}

describe('authorizeWorkspaceOperation permission-group capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolvePermissionGroupConfig.mockResolvedValue(null)
  })

  it('refuses a session whose group withholds the capability', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(principal, capabilityOperation, context)
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  it('names the capability and a code a caller can branch on', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(withholdingConfig())

    const error = await authorizeWorkspaceOperation(principal, capabilityOperation, context).catch(
      (thrown: unknown) => thrown
    )

    expect(error).toBeInstanceOf(PermissionGroupCapabilityError)
    expect((error as PermissionGroupCapabilityError).capability).toBe('tables.use')
    expect((error as PermissionGroupCapabilityError).detailCode).toBe(
      'PERMISSION_GROUP_CAPABILITY_BLOCKED'
    )
  })

  it('refuses a personal API key the same way', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, capabilityOperation, context)
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  it('refuses a delegated principal that carries a user subject', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(
        {
          ...executorPrincipal(
            { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            { workflowId: 'current-workflow-1', mode: 'draft' }
          ),
          subjectUserId: 'user-1',
        },
        capabilityOperation,
        context,
        executorAuthorization
      )
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  /**
   * A workspace API key authorizes as the workspace, so no group resolves for
   * it. Documented policy rather than an oversight — the escape is closed by
   * capability-gating key creation, not by guessing a user here.
   */
  it('does not apply to a workspace API key, which has no user', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(scopedWorkspaceKeyPrincipal, capabilityOperation, context)
    ).resolves.toBeUndefined()
    expect(mocks.resolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  /**
   * A deployment run has no subject, so denying here would 403 every schedule
   * and webhook in the organization. What the run does is still gated by the
   * executor.
   */
  it('does not apply to an actorless deployment run', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(
        executorPrincipal(undefined, { workflowId: 'current-workflow-1', mode: 'deployment' }),
        capabilityOperation,
        context,
        executorAuthorization
      )
    ).resolves.toBeUndefined()
    expect(mocks.resolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  it('allows the operation when the group permits the capability', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    await expect(
      authorizeWorkspaceOperation(principal, capabilityOperation, context)
    ).resolves.toBeUndefined()
  })

  it('allows the operation when no group governs the user', async () => {
    await expect(
      authorizeWorkspaceOperation(principal, capabilityOperation, context)
    ).resolves.toBeUndefined()
  })

  it('skips the lookup entirely for a workspace with no organization', async () => {
    await expect(
      authorizeWorkspaceOperation(principal, capabilityOperation, {
        ...context,
        workspaceOrganizationId: null,
      })
    ).resolves.toBeUndefined()
    expect(mocks.resolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  it('refuses on role before capability, so a non-member learns nothing about the group', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    mocks.resolvePermissionGroupConfig.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(principal, capabilityOperation, context)
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
    expect(mocks.resolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})

describe('defineWorkspaceOperation capability policy', () => {
  it('refuses a parameterized capability, which the funnel could never apply', () => {
    expect(() =>
      defineWorkspaceOperation({
        id: 'test.parameterized',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['session'],
        // @ts-expect-error a parameterized capability is not assignable to the field
        capability: 'deploy.chat.auth_mode',
      })
    ).toThrow(/parameterized capability/)
  })

  it('accepts an explicit opt-out', () => {
    expect(() =>
      defineWorkspaceOperation({
        id: 'test.ungoverned',
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['session'],
        capability: 'none',
      })
    ).not.toThrow()
  })
})

const personalKeyOperation = defineWorkspaceOperation({
  id: 'test.personal-key-read',
  minimumRole: 'read',
  workspaceApiKey: 'allow',
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
  capability: 'none',
})

/**
 * The workspace column and the group key combine with AND. The column is the
 * coarse switch every workspace has; the group narrows it for one cohort inside
 * an enterprise organization.
 */
describe('authorizeWorkspaceOperation personal API key policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolvePermissionGroupConfig.mockResolvedValue(null)
  })

  it('refuses when the permission group withholds personal keys', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, personalKeyOperation, context)
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
  })

  it('refuses when the workspace withholds them, without consulting the group', async () => {
    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, personalKeyOperation, {
        ...context,
        allowPersonalApiKeys: false,
      })
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
    expect(mocks.resolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  it('allows when both layers permit', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, personalKeyOperation, context)
    ).resolves.toBeUndefined()
  })

  it('leaves a session principal alone', async () => {
    mocks.resolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    await expect(
      authorizeWorkspaceOperation(principal, personalKeyOperation, context)
    ).resolves.toBeUndefined()
  })
})
