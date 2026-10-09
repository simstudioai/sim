import type { Principal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import {
  type CopilotExecutionContext,
  createCopilotResourceAdmission,
  hasCopilotResourceAdmission,
} from '@/lib/mothership/auth/application-delegation'

const operation = Object.freeze({
  id: 'projects.list',
  capability: 'none',
  principalKinds: Object.freeze(['resource_delegated']),
  delegatedServices: Object.freeze(['copilot']),
  delegationAudience: 'sim:projects:discovery',
} as const)
const delegation = {
  audience: operation.delegationAudience,
  ttlMs: 60_000,
  createDelegationId: (context: { toolCallId: string }) => context.toolCallId,
}
const useCase = {
  operation,
  async execute({ principal }: { principal: Principal; input: unknown }) {
    return principal
  },
}
const adapter = () =>
  createCopilotApplicationAdapter({
    mode: 'resource',
    domain: 'projects',
    delegation,
    operations: { list: operation },
    resourceScope: { kind: 'project_discovery' },
  })

function admittedContext(): CopilotExecutionContext {
  return {
    userId: 'real-user',
    chatId: 'real-chat',
    toolCallId: 'real-tool-call',
    copilotToolExecution: true,
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId: 'real-user',
      invocation: { kind: 'chat', chatId: 'real-chat' },
    }),
  }
}

describe('Copilot resource authoring admission', () => {
  it('recognizes turn admission before a tool call exists without accepting copied recovery evidence', () => {
    const context = { ...admittedContext(), toolCallId: undefined }
    expect(hasCopilotResourceAdmission(context)).toBe(true)
    for (const changed of [
      { ...context, userId: 'other' },
      { ...context, chatId: 'other' },
      { ...context, mcpBlockId: 'block' },
      { ...context, executorDelegationOrigin: {} },
      { ...context, copilotResourceAdmission: { ...context.copilotResourceAdmission } },
    ]) {
      expect(hasCopilotResourceAdmission(changed as never)).toBe(false)
    }
  })

  it('binds the actual user and invocation without a selected workspace', async () => {
    const result = await adapter()(admittedContext(), useCase, {
      userId: 'forged-user',
      chatId: 'forged-chat',
      scope: { kind: 'entity', entityType: 'organization', entityId: 'other' },
    })
    expect(result).toMatchObject({
      kind: 'resource_delegated',
      subjectUserId: 'real-user',
      serviceId: 'copilot',
      delegationId: 'real-tool-call',
      invocation: { kind: 'chat', chatId: 'real-chat' },
      scope: { kind: 'project_discovery' },
    })
  })

  it('retains editor workflow and Copilot run identity without treating them as workflow authority', async () => {
    const result = await adapter()(
      { ...admittedContext(), workflowId: 'edited-workflow', executionId: 'copilot-run' },
      useCase,
      {}
    )
    expect(result.kind).toBe('resource_delegated')
  })

  it('accepts an explicitly admitted workspace authoring run without a chat', async () => {
    const result = await adapter()(
      {
        userId: 'real-user',
        workspaceId: 'workspace',
        toolCallId: 'tool',
        copilotToolExecution: true,
        copilotInteractionMode: 'headless',
        copilotResourceAdmission: createCopilotResourceAdmission({
          userId: 'real-user',
          invocation: { kind: 'workspace', workspaceId: 'workspace' },
        }),
      },
      useCase,
      {}
    )
    expect(result).toMatchObject({ invocation: { kind: 'workspace', workspaceId: 'workspace' } })
  })

  it.each([
    ['another subject', { userId: 'other' }],
    ['another chat', { chatId: 'other' }],
    ['missing tool identity', { toolCallId: undefined }],
    ['missing admission', { copilotResourceAdmission: undefined }],
    ['executor origin', { executorDelegationOrigin: { workflowId: 'workflow' } }],
    ['Mothership block', { mcpBlockId: 'block' }],
    ['workflow execution', { boundWorkflowExecutionId: 'workflow-execution' }],
  ])('rejects %s even when old origin flags say interactive', (_name, changes) => {
    const context = { ...admittedContext(), copilotInteractionMode: 'interactive', ...changes }
    expect(() => adapter()(context as never, useCase, {})).toThrow()
  })

  it('does not accept serialized or copied admission objects', () => {
    const context = admittedContext()
    for (const admission of [
      { userId: 'real-user', invocation: { kind: 'chat', chatId: 'real-chat' } },
      { ...context.copilotResourceAdmission },
    ]) {
      expect(() =>
        adapter()({ ...context, copilotResourceAdmission: admission } as never, useCase, {})
      ).toThrow('authoring admission')
    }
  })

  it('refuses same-ID operation substitution', () => {
    expect(() =>
      adapter()(admittedContext(), { ...useCase, operation: { ...operation } }, {})
    ).toThrow('Unregistered Copilot projects operation')
  })

  it('refuses a registered operation that does not admit Copilot resource delegation', () => {
    const refusedOperation = Object.freeze({
      ...operation,
      delegatedServices: Object.freeze(['realtime']),
    } as const)
    const execute = createCopilotApplicationAdapter({
      mode: 'resource',
      domain: 'projects',
      delegation,
      operations: { list: refusedOperation },
      resourceScope: { kind: 'project_discovery' },
    })
    expect(() =>
      execute(admittedContext(), { ...useCase, operation: refusedOperation }, {})
    ).toThrow('does not admit Copilot resource delegation')
  })

  it('refuses the wrong domain audience even with a registered operation', () => {
    const execute = createCopilotApplicationAdapter({
      mode: 'resource',
      domain: 'projects',
      delegation: { ...delegation, audience: 'sim:files' },
      operations: { list: operation },
      resourceScope: { kind: 'project_discovery' },
    })
    expect(() => execute(admittedContext(), useCase, {})).toThrow('delegation audience')
  })

  it('projects a requested file bound only from the adapter scope argument', async () => {
    const execute = createCopilotApplicationAdapter<typeof operation, { fileId: string }>({
      mode: 'resource',
      domain: 'projects',
      delegation,
      operations: { list: operation },
      projectResourceScope: ({ fileId }) => ({
        kind: 'entity',
        entityType: 'project',
        entityId: 'project',
        fileId,
      }),
    })
    const result = await execute(
      admittedContext(),
      useCase,
      { fileId: 'forged' },
      { fileId: 'file' }
    )
    expect(result).toMatchObject({
      scope: { kind: 'entity', entityType: 'project', entityId: 'project', fileId: 'file' },
    })
  })

  it('copy delegation cannot be widened by mutating nested requested targets after admission', async () => {
    const copyOperation = Object.freeze({
      ...operation,
      id: 'files.copy',
      delegationAudience: 'sim:files:copy',
    })
    const scope = {
      kind: 'file_copy' as const,
      source: {
        owner: { entityType: 'workspace' as const, entityId: 'source' },
        fileIds: ['one'],
        folderIds: [] as string[],
      },
      destination: {
        owner: { entityType: 'project' as const, entityId: 'destination' },
        folderId: null as string | null,
      },
    }
    const required = structuredClone(scope)
    const execute = createCopilotApplicationAdapter({
      mode: 'resource',
      domain: 'file-copy',
      delegation: { ...delegation, audience: copyOperation.delegationAudience },
      operations: { copy: copyOperation },
      resourceScope: scope,
    })
    const result = await execute(admittedContext(), { ...useCase, operation: copyOperation }, {})
    scope.source.owner.entityId = 'another-owner'
    scope.source.fileIds.push('extra-file')
    scope.destination.folderId = 'another-folder'
    expect(
      requireResourceDelegation(result, {
        audience: copyOperation.delegationAudience,
        services: ['copilot'],
        maxTtlMs: 60_000,
        scope: required,
      })
    ).toBe('real-user')
    expect(() =>
      requireResourceDelegation(result, {
        audience: copyOperation.delegationAudience,
        services: ['copilot'],
        maxTtlMs: 60_000,
        scope,
      })
    ).toThrow('Resource delegation is no longer valid')
    if (result.kind !== 'resource_delegated' || result.scope.kind !== 'file_copy')
      throw new Error('Missing copy grant')
    expect(Reflect.set(result.scope.source.owner, 'entityId', 'forged')).toBe(false)
    expect(Reflect.set(result.scope.source.fileIds, '1', 'injected')).toBe(false)
    expect(Reflect.set(result.scope.destination, 'folderId', 'forged')).toBe(false)
  })
})
