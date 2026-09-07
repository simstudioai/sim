/**
 * @vitest-environment node
 */
import type {
  DelegatedPrincipal,
  OAuthAccessTokenPrincipal,
  PersonalApiKeyPrincipal,
  SessionPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import {
  authorizeWorkspaceOperation,
  capabilityGovernedPrincipalUserId,
  defineWorkspaceOperation,
  InsufficientScopeError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  OAuthAccessTokenExpiredError,
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
  capability: 'none',
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
  capability: 'none',
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
  capability: 'none',
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

const copilotCapabilityOperation = defineWorkspaceOperation({
  id: 'test.copilot-capability-read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
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
    resolveGroupConfigMock.mockResolvedValue(null)
  })

  it('refuses a session whose group withholds the capability', async () => {
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(principal, capabilityOperation, context)
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  it('names the capability and a code a caller can branch on', async () => {
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

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
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, capabilityOperation, context)
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  /**
   * A run carries the triggering user's role but not their capabilities. The
   * alternative would make "hide Tables from the sidebar" a runtime kill-switch
   * for every workflow with a Table block, which is not what the checkbox says
   * and not what an admin ticking it intends.
   */
  it('does not apply to an executor run, even one carrying a user subject', async () => {
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

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
    ).resolves.toBeUndefined()
  })

  it('still enforces the workspace role for an executor run', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

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
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
  })

  /**
   * Copilot acts as the person, so it must not reach what the person may not.
   */
  it('does apply to a Copilot delegation, which acts as the person', async () => {
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(
        {
          ...executorPrincipal(
            { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            { workflowId: 'current-workflow-1', mode: 'draft' }
          ),
          serviceId: 'copilot',
          subjectUserId: 'user-1',
        },
        copilotCapabilityOperation,
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
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(scopedWorkspaceKeyPrincipal, capabilityOperation, context)
    ).resolves.toBeUndefined()
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  /**
   * A deployment run has no subject, so denying here would 403 every schedule
   * and webhook in the organization. What the run does is still gated by the
   * executor.
   */
  it('does not apply to an actorless deployment run', async () => {
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(
        executorPrincipal(undefined, { workflowId: 'current-workflow-1', mode: 'deployment' }),
        capabilityOperation,
        context,
        executorAuthorization
      )
    ).resolves.toBeUndefined()
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  it('allows the operation when the group permits the capability', async () => {
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

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
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  it('refuses on role before capability, so a non-member learns nothing about the group', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    resolveGroupConfigMock.mockResolvedValue(withholdingConfig())

    await expect(
      authorizeWorkspaceOperation(principal, capabilityOperation, context)
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
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
    resolveGroupConfigMock.mockResolvedValue(null)
  })

  it('refuses when the permission group withholds personal keys', async () => {
    resolveGroupConfigMock.mockResolvedValue({
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
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  it('allows when both layers permit', async () => {
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, personalKeyOperation, context)
    ).resolves.toBeUndefined()
  })

  /**
   * A `NoWorkspaceAccessError` is concealed as a `404`, so it has to come first:
   * a distinct `PersonalApiKeysDisabledError` would tell a caller with no reach
   * into the workspace that it exists and that its organization withholds
   * personal keys.
   */
  it('conceals the workspace before refusing the group personal-key setting', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, personalKeyOperation, context)
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
    expect(resolveGroupConfigMock).not.toHaveBeenCalled()
  })

  /**
   * The workspace column keeps its fail-fast: it is a property of the workspace
   * rather than of any group, so it is not the organization-configuration
   * oracle the group key would be, and three call-site suites pin the ordering.
   */
  it('keeps refusing the workspace personal-key column before the role lookup', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      authorizeWorkspaceOperation(personalKeyPrincipal, personalKeyOperation, {
        ...context,
        allowPersonalApiKeys: false,
      })
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  it('leaves a session principal alone', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    await expect(
      authorizeWorkspaceOperation(principal, personalKeyOperation, context)
    ).resolves.toBeUndefined()
  })
})

/**
 * The sites that cannot ride on an operation's `capability` — they need the
 * resource in hand — read the governed person from here. Pinned against the
 * funnel above, because the tempting alternatives are all bystanders: an
 * attribution helper's billing owner, a workspace key's creator, or the subject
 * of an executor run the funnel exempts.
 */
describe('capabilityGovernedPrincipalUserId', () => {
  it('names the person for a session and a personal key', () => {
    expect(capabilityGovernedPrincipalUserId(principal)).toBe('user-1')
    expect(
      capabilityGovernedPrincipalUserId({
        kind: 'personal_api_key',
        userId: 'user-2',
        keyId: 'key-1',
      })
    ).toBe('user-2')
  })

  it('names nobody for a workspace key, which has no user', () => {
    expect(capabilityGovernedPrincipalUserId(workspaceKeyPrincipal)).toBeNull()
  })

  it('names nobody for an executor run, subject or not', () => {
    expect(capabilityGovernedPrincipalUserId(executorPrincipal(undefined))).toBeNull()
    expect(
      capabilityGovernedPrincipalUserId({
        ...executorPrincipal(undefined),
        subjectUserId: 'user-1',
      })
    ).toBeNull()
  })

  it('names the person a non-executor delegation acts as', () => {
    expect(
      capabilityGovernedPrincipalUserId({
        ...executorPrincipal(undefined),
        serviceId: 'copilot',
        subjectUserId: 'user-3',
      })
    ).toBe('user-3')
  })
})

describe('authorizeWorkspaceOperation OAuth access token policy', () => {
  const readOperation = defineWorkspaceOperation({
    id: 'test.oauth-read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'none',
  })
  const oauthWriteOperation = defineWorkspaceOperation({
    id: 'test.oauth-write',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'none',
  })

  function token(overrides: Partial<OAuthAccessTokenPrincipal> = {}): OAuthAccessTokenPrincipal {
    return {
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'sim-cli',
      tokenId: 'token-1',
      scopes: ['offline_access', 'api:read', 'api:write'],
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)
  })

  it('walks the personal-key sequence for a token with the right scope', async () => {
    await expect(
      authorizeWorkspaceOperation(token(), oauthWriteOperation, context)
    ).resolves.toBeUndefined()
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(resolveGroupConfigMock).toHaveBeenCalled()
  })

  it('refuses a token carrying neither API scope before touching the workspace', async () => {
    const failure = await authorizeWorkspaceOperation(
      token({ scopes: ['offline_access'] }),
      readOperation,
      context
    ).catch((error) => error)

    expect(failure).toBeInstanceOf(InsufficientScopeError)
    expect(failure.requiredScope).toBe('api:read')
    expect(failure.detailCode).toBe('INSUFFICIENT_SCOPE')
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  it('rejects a read-only token on a semantic write before reading membership', async () => {
    await expect(
      authorizeWorkspaceOperation(
        token({ scopes: ['offline_access', 'api:read'] }),
        oauthWriteOperation,
        context
      )
    ).rejects.toMatchObject({ requiredScope: 'api:write' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  it('lets api:write satisfy a read operation', async () => {
    await expect(
      authorizeWorkspaceOperation(
        token({ scopes: ['offline_access', 'api:write'] }),
        readOperation,
        context
      )
    ).resolves.toBeUndefined()
  })

  /**
   * The request-time half of the `cli.use` gate. The consent page enforces it
   * when the grant is made, but a consent already on file lets every later
   * authorization skip that endpoint — so withdrawing the capability has to
   * stop the token already in the user's hands.
   */
  it('refuses a Sim CLI token once the group withholds cli.use', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableCliAccess: true,
    })

    await expect(
      authorizeWorkspaceOperation(token(), readOperation, context)
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  it('leaves a third-party client alone, which cli.use does not govern', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableCliAccess: true,
    })

    await expect(
      authorizeWorkspaceOperation(token({ clientId: 'partner-app' }), readOperation, context)
    ).resolves.toBeUndefined()
  })

  it('refuses a lapsed token as unauthorized rather than forbidden', async () => {
    const failure = await authorizeWorkspaceOperation(
      token({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }),
      readOperation,
      context
    ).catch((error) => error)

    expect(failure).toBeInstanceOf(OAuthAccessTokenExpiredError)
    expect(failure.code).toBe('unauthorized')
  })

  it('is governed by the workspace personal-key column like a personal key', async () => {
    await expect(
      authorizeWorkspaceOperation(token(), readOperation, {
        ...context,
        allowPersonalApiKeys: false,
      })
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  it('is governed by the group personal-key setting, after the role check', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    await expect(
      authorizeWorkspaceOperation(token(), readOperation, context)
    ).rejects.toBeInstanceOf(PersonalApiKeysDisabledError)
    expect(mocks.resolvePermission).toHaveBeenCalled()
  })

  it('conceals a workspace the person cannot reach', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      authorizeWorkspaceOperation(token(), readOperation, context)
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)
  })

  it('names the person for capability purposes', () => {
    expect(capabilityGovernedPrincipalUserId(token())).toBe('user-1')
  })
})
