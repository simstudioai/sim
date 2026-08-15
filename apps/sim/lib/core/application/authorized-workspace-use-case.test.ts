/**
 * @vitest-environment node
 */
import type {
  DelegatedPrincipal,
  PersonalApiKeyPrincipal,
  SessionPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  recordAudit: vi.fn(() => mocks.events.push('audit')),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_UPDATED: 'file.updated' },
  AuditResourceType: { FILE: 'file' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import type { OrchestrationError } from '@/lib/core/orchestration/types'

const operation = defineWorkspaceOperation({
  id: 'test.rename',
  minimumRole: 'write',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
})

const delegatedOperation = defineWorkspaceOperation({
  id: 'test.delegated_read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
})

const workspaceKeyOperation = defineWorkspaceOperation({
  id: 'test.workspace_key_read',
  minimumRole: 'read',
  workspaceApiKey: 'allow',
  principalKinds: ['workspace_api_key'],
})

interface TestInput {
  resourceId: string
}

interface TestContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  canonicalResourceId: string
}

const canonicalContext: TestContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  canonicalResourceId: 'resource-1',
}

const sessionPrincipal: SessionPrincipal = {
  kind: 'session',
  userId: 'user-1',
  sessionId: 'session-1',
}

describe('defineAuthorizedWorkspaceUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.events.length = 0
    mocks.resolvePermission.mockResolvedValue('write')
  })

  it('narrows definition callbacks while keeping public execution principal-safe', async () => {
    const resolveContext = vi.fn(
      async ({ principal }: { principal: SessionPrincipal; input: TestInput }) => {
        expectTypeOf(principal).toEqualTypeOf<SessionPrincipal>()
        return canonicalContext
      }
    )
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation,
      resolveContext,
      authorizationOptions: {},
      async execute({ principal, context }) {
        expectTypeOf(principal).toEqualTypeOf<SessionPrincipal>()
        expectTypeOf(context).toEqualTypeOf<TestContext>()
        return { resource: { id: context.canonicalResourceId, name: 'Renamed' } }
      },
    })

    const disallowedPrincipal: PersonalApiKeyPrincipal = {
      kind: 'personal_api_key',
      userId: 'user-1',
      keyId: 'key-1',
    }
    await expect(
      useCase.execute({ principal: disallowedPrincipal, input: { resourceId: 'resource-1' } })
    ).rejects.toMatchObject<Partial<OrchestrationError>>({ code: 'forbidden' })

    expect(resolveContext).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('authorizes canonical context, enriches one audit entry, then runs afterSuccess', async () => {
    const request = { headers: new Headers({ 'user-agent': 'vitest' }) }
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation,
      resolveContext: async ({ input }: { principal: SessionPrincipal; input: TestInput }) => ({
        ...canonicalContext,
        canonicalResourceId: input.resourceId,
      }),
      authorizationOptions: {},
      async execute({ context }) {
        mocks.events.push('execute')
        return { resource: { id: context.canonicalResourceId, name: 'Renamed' } }
      },
      projectAudit({ result }) {
        return {
          action: AuditAction.FILE_UPDATED,
          resourceType: AuditResourceType.FILE,
          resourceId: result.resource.id,
          resourceName: result.resource.name,
          metadata: { operation: 'spoofed', actor: 'spoofed', retained: true },
        }
      },
      async afterSuccess() {
        mocks.events.push('afterSuccess')
      },
    })

    await expect(
      useCase.execute({
        principal: sessionPrincipal,
        input: { resourceId: 'resource-1' },
        request,
      })
    ).resolves.toEqual({ resource: { id: 'resource-1', name: 'Renamed' } })

    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      actorName: undefined,
      action: 'file.updated',
      resourceType: 'file',
      resourceId: 'resource-1',
      resourceName: 'Renamed',
      description: undefined,
      metadata: {
        retained: true,
        operation: 'test.rename',
        actor: { kind: 'session', userId: 'user-1' },
      },
      request,
    })
    expect(mocks.events).toEqual(['execute', 'audit', 'afterSuccess'])
  })

  it('runs resource authorization after workspace authorization and before business effects', async () => {
    mocks.resolvePermission.mockImplementation(async () => {
      mocks.events.push('workspaceAuthorization')
      return 'write'
    })
    const execute = vi.fn(async () => {
      mocks.events.push('execute')
      return { ok: true as const }
    })
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation,
      resolveContext: async (_args: { principal: SessionPrincipal; input: TestInput }) => {
        mocks.events.push('canonicalLoad')
        return canonicalContext
      },
      authorizationOptions: {},
      authorizeResource() {
        mocks.events.push('resourceAuthorization')
      },
      execute,
      projectAudit: () => ({
        action: AuditAction.FILE_UPDATED,
        resourceType: AuditResourceType.FILE,
      }),
      afterSuccess() {
        mocks.events.push('afterSuccess')
      },
    })

    await useCase.authorize?.({
      principal: sessionPrincipal,
      input: { resourceId: 'resource-1' },
    })

    expect(mocks.events).toEqual([
      'canonicalLoad',
      'workspaceAuthorization',
      'resourceAuthorization',
    ])
    expect(execute).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()

    mocks.events.length = 0
    await expect(
      useCase.execute({
        principal: sessionPrincipal,
        input: { resourceId: 'resource-1' },
      })
    ).resolves.toEqual({ ok: true })
    expect(mocks.events).toEqual([
      'canonicalLoad',
      'workspaceAuthorization',
      'resourceAuthorization',
      'execute',
      'audit',
      'afterSuccess',
    ])
  })

  it('supports zero or many semantic audit entries', async () => {
    const buildUseCase = (auditCount: number) =>
      defineAuthorizedWorkspaceUseCase({
        operation,
        resolveContext: async (_args: { principal: SessionPrincipal; input: TestInput }) =>
          canonicalContext,
        authorizationOptions: {},
        async execute() {
          return { auditCount }
        },
        projectAudit({ result }) {
          return Array.from({ length: result.auditCount }, (_, index) => ({
            action: AuditAction.FILE_UPDATED,
            resourceType: AuditResourceType.FILE,
            resourceId: `resource-${index}`,
          }))
        },
      })

    await buildUseCase(0).execute({
      principal: sessionPrincipal,
      input: { resourceId: 'resource-1' },
    })
    expect(mocks.recordAudit).not.toHaveBeenCalled()

    await buildUseCase(2).execute({
      principal: sessionPrincipal,
      input: { resourceId: 'resource-1' },
    })
    expect(mocks.recordAudit).toHaveBeenCalledTimes(2)
  })

  it('resolves domain-specific delegation options against canonical context', async () => {
    const scopeCheck = vi.fn(
      (principal: DelegatedPrincipal, context: TestContext) =>
        principal.resourceScope?.fileId === context.canonicalResourceId
    )
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation: delegatedOperation,
      resolveContext: async (_args: { principal: DelegatedPrincipal; input: TestInput }) =>
        canonicalContext,
      authorizationOptions: ({ principal }) => {
        expectTypeOf(principal).toMatchTypeOf<DelegatedPrincipal>()
        expectTypeOf(principal.serviceId).toEqualTypeOf<'executor'>()
        return {
          delegation: {
            audience: 'test:files',
            isWithinScope: scopeCheck,
          },
        }
      },
      async execute({ principal }) {
        expectTypeOf(principal).toMatchTypeOf<DelegatedPrincipal>()
        expectTypeOf(principal.serviceId).toEqualTypeOf<'executor'>()
        return { ok: true as const }
      },
    })
    const principal: DelegatedPrincipal = {
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'test:files',
      issuedAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { fileId: 'resource-1' },
    }

    await expect(
      useCase.execute({ principal, input: { resourceId: 'resource-1' } })
    ).resolves.toEqual({ ok: true })
    expect(scopeCheck).toHaveBeenCalledWith(principal, canonicalContext)
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
  })

  it('rejects a disallowed delegated service before canonical loading', async () => {
    const resolveContext = vi.fn(
      async (_args: { principal: DelegatedPrincipal; input: TestInput }) => canonicalContext
    )
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation: delegatedOperation,
      resolveContext,
      authorizationOptions: {
        delegation: { audience: 'test:files', isWithinScope: () => true },
      },
      async execute() {
        return { ok: true as const }
      },
    })

    await expect(
      useCase.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          delegationId: 'delegation-1',
          audience: 'test:files',
          issuedAt: new Date(Date.now() - 1_000),
          expiresAt: new Date(Date.now() + 60_000),
        },
        input: { resourceId: 'resource-1' },
      })
    ).rejects.toMatchObject<Partial<OrchestrationError>>({
      code: 'forbidden',
      message: 'Delegated service copilot cannot perform operation test.delegated_read',
    })
    expect(resolveContext).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  it('records workspace API keys as non-human audit actors', async () => {
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation: workspaceKeyOperation,
      resolveContext: async (_args: { principal: WorkspaceApiKeyPrincipal; input: TestInput }) =>
        canonicalContext,
      authorizationOptions: {},
      async execute() {
        return { id: 'resource-1' }
      },
      projectAudit({ result }) {
        return {
          action: AuditAction.FILE_UPDATED,
          resourceType: AuditResourceType.FILE,
          resourceId: result.id,
        }
      },
    })

    await useCase.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key-1',
      },
      input: { resourceId: 'resource-1' },
    })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: {
          operation: 'test.workspace_key_read',
          actor: {
            kind: 'workspace_api_key',
            workspaceId: 'workspace-1',
            keyId: 'workspace-key-1',
          },
        },
      })
    )
  })
})
