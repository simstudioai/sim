/**
 * @vitest-environment node
 */
import type {
  DelegatedPrincipal,
  SessionPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import {
  authorizeWorkspaceOperation,
  defineWorkspaceOperation,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'

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
