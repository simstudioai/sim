import type {
  DelegatedPrincipal,
  SessionPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import type { OrchestrationError } from '@/lib/core/orchestration/types'
import { CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION } from '@/lib/resource-policies/registry'

const mocks = {
  routingEnabled: networkConfigMockFns.mockIsOutboundRoutingEnabled,
  resolveRoute: networkConfigMockFns.mockResolveOutboundRoute,
  events: [] as string[],
  recordAudit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}
mocks.recordAudit.mockImplementation(() => {
  mocks.events.push('audit')
})

const operation = defineWorkspaceOperation({
  id: 'test.rename',
  minimumRole: 'write',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
  capability: 'none',
})

const delegatedOperation = defineWorkspaceOperation({
  id: 'test.delegated_read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
  capability: 'none',
})

const workspaceKeyOperation = defineWorkspaceOperation({
  id: 'test.workspace_key_read',
  minimumRole: 'read',
  workspaceApiKey: 'allow',
  principalKinds: ['workspace_api_key'],
  capability: 'none',
})

const resourcePolicyOperation = defineWorkspaceOperation({
  id: 'test.resource_policy',
  minimumRole: 'write',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
  resourcePolicy: {
    resourceType: 'credential_group',
    action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
  },
  capability: 'none',
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

const sessionPrincipal = createSessionPrincipal()

describe('defineAuthorizedWorkspaceUseCase', () => {
  beforeEach(() => {
    mocks.routingEnabled.mockReturnValue(false)
    mocks.events.length = 0
    mocks.resolvePermission.mockResolvedValue('write')
  })

  it('establishes outbound ownership after authorization and retains it through effects', async () => {
    mocks.routingEnabled.mockReturnValue(true)
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation,
      resolveContext: async () => canonicalContext,
      authorizationOptions: {},
      async execute() {
        expect(mocks.resolvePermission).toHaveBeenCalledOnce()
        await resolveCurrentOutboundRoute()
        return 'done'
      },
      async afterSuccess() {
        await resolveCurrentOutboundRoute()
      },
    })
    await expect(useCase.execute({ principal: sessionPrincipal, input: {} })).resolves.toBe('done')
    expect(mocks.resolveRoute.mock.calls).toEqual([['organization-1'], ['organization-1']])
    await resolveCurrentOutboundRoute()
    expect(mocks.resolveRoute).toHaveBeenLastCalledWith(undefined)

    mocks.resolveRoute.mockClear()
    mocks.resolvePermission.mockResolvedValue(null)
    await expect(useCase.execute({ principal: sessionPrincipal, input: {} })).rejects.toThrow()
    expect(mocks.resolveRoute).not.toHaveBeenCalled()
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

    const disallowedPrincipal = createPersonalApiKeyPrincipal()
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
      operation: resourcePolicyOperation,
      resolveContext: async (_args: { principal: SessionPrincipal; input: TestInput }) => {
        mocks.events.push('canonicalLoad')
        return canonicalContext
      },
      authorizationOptions: {},
      authorizeResource({ resourcePolicy }) {
        expect(resourcePolicy).toBe(resourcePolicyOperation.resourcePolicy)
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

  it('requires policy-bound operations to define resource authorization', async () => {
    const execute = vi.fn(async () => ({ ok: true as const }))
    expect(() =>
      defineAuthorizedWorkspaceUseCase({
        operation: resourcePolicyOperation,
        resolveContext: async (_args: { principal: SessionPrincipal; input: TestInput }) =>
          canonicalContext,
        authorizationOptions: {},
        execute,
      })
    ).toThrow('Operation test.resource_policy requires resource policy authorization')

    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps non-policy resource authorization available to ordinary operations', async () => {
    const authorizeResource = vi.fn()
    const useCase = defineAuthorizedWorkspaceUseCase({
      operation,
      resolveContext: async (_args: { principal: SessionPrincipal; input: TestInput }) =>
        canonicalContext,
      authorizationOptions: {},
      authorizeResource,
      async execute() {
        return { ok: true as const }
      },
    })

    await expect(
      useCase.execute({
        principal: sessionPrincipal,
        input: { resourceId: 'resource-1' },
      })
    ).resolves.toEqual({ ok: true })
    expect(authorizeResource).toHaveBeenCalledWith(
      expect.objectContaining({ context: canonicalContext })
    )
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
      principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }),
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

describe('projected audit workspace attribution', () => {
  it.each([
    { override: undefined, expected: 'workspace-1' },
    { override: 'workspace-2', expected: 'workspace-2' },
    { override: null, expected: null },
  ])('records the canonical workspace override $override', ({ override, expected }) => {
    recordProjectedUseCaseAuditEntries(
      operation,
      'workspace-1',
      sessionPrincipal,
      undefined,
      [
        {
          action: AuditAction.FILE_UPDATED,
          resourceType: AuditResourceType.FILE,
          workspaceId: override,
        },
      ],
      'organization-1'
    )
    expect(mocks.recordAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: expected,
        metadata: expect.objectContaining({ organizationId: 'organization-1' }),
      })
    )
  })
})

/** Private per-call target scope is checked against canonical resources, not URL parameters. */
describe('workspace invocation targeting', () => {
  const contextFor = (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: 'org-1',
    allowPersonalApiKeys: true,
  })
  const scopedRead = defineAuthorizedWorkspaceUseCase({
    operation,
    resolveContext: ({ input }: { input: { workspaceId: string } }) =>
      contextFor(input.workspaceId),
    async execute({ context }) {
      return context.workspaceId
    },
  })
  it('rejects an ID-only resource in another workspace and leaves later calls unscoped', async () => {
    mocks.resolvePermission.mockResolvedValue('write')
    await expect(
      withWorkspaceInvocationScope({ workspaceId: 'ws-1', organizationId: 'org-1' }, () =>
        scopedRead.execute({ principal: sessionPrincipal, input: { workspaceId: 'ws-2' } })
      )
    ).rejects.toThrow('selected workspace')
    await expect(
      scopedRead.execute({ principal: sessionPrincipal, input: { workspaceId: 'ws-2' } })
    ).resolves.toBe('ws-2')
  })
  it('isolates concurrent invocations and rejects a second top-level operation after a valid first', async () => {
    mocks.resolvePermission.mockResolvedValue('write')
    await Promise.all(
      ['ws-1', 'ws-2'].map((workspaceId) =>
        withWorkspaceInvocationScope({ workspaceId }, async () => {
          await expect(
            scopedRead.execute({ principal: sessionPrincipal, input: { workspaceId } })
          ).resolves.toBe(workspaceId)
          await expect(
            scopedRead.execute({
              principal: sessionPrincipal,
              input: { workspaceId: workspaceId === 'ws-1' ? 'ws-2' : 'ws-1' },
            })
          ).rejects.toThrow('selected workspace')
        })
      )
    )
  })
  it('allows explicit secondary operations only inside an admitted compound body and retains their permission checks', async () => {
    const compound = defineAuthorizedWorkspaceUseCase({
      operation,
      resolveContext: () => contextFor('ws-1'),
      execute: () =>
        scopedRead.execute({ principal: sessionPrincipal, input: { workspaceId: 'ws-2' } }),
    })
    mocks.resolvePermission.mockResolvedValue('write')
    await expect(
      withWorkspaceInvocationScope({ workspaceId: 'ws-1' }, () =>
        compound.execute({ principal: sessionPrincipal, input: {} })
      )
    ).resolves.toBe('ws-2')
    mocks.resolvePermission.mockImplementation((_user: string, workspaceId: string) =>
      workspaceId === 'ws-1' ? 'write' : null
    )
    await expect(
      withWorkspaceInvocationScope({ workspaceId: 'ws-1' }, () =>
        compound.execute({ principal: sessionPrincipal, input: {} })
      )
    ).rejects.toThrow()
  })
})
