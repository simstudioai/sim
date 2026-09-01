/**
 * @vitest-environment node
 */
import type { DelegatedPrincipal } from '@sim/auth/principal'
import { describe, expect, it, vi } from 'vitest'
import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import {
  type CopilotDelegationConfiguration,
  type CopilotResourceScope,
  createCopilotApplicationPrincipal,
  type TrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import { defineWorkspaceOperation, type WorkspaceOperation } from '@/lib/core/application'

const operation = defineWorkspaceOperation({
  id: 'files.read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
  capability: 'files.use',
})

const delegation = {
  audience: 'sim:files',
  ttlMs: 5 * 60 * 1000,
  createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
} as const satisfies CopilotDelegationConfiguration

const trustedContext = {
  userId: 'trusted-user',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

interface FileScopeInput {
  fileId: string
}

function createAdapter(
  createPrincipal?: (args: {
    context: TrustedCopilotExecutionContext
    resourceScope: CopilotResourceScope
  }) => DelegatedPrincipal
) {
  return createCopilotApplicationAdapter<WorkspaceOperation, FileScopeInput>({
    domain: 'file',
    delegation,
    operations: { read: operation },
    projectResourceScope: ({ fileId }) => ({ fileId }),
    createPrincipal,
  })
}

describe('Copilot application adapter', () => {
  it('binds only code-projected scope and leaves model input non-authoritative', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })

    await createAdapter()(
      trustedContext,
      { operation, execute },
      { fileId: 'model-forged-file' },
      { fileId: 'trusted-file' }
    )

    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        subjectUserId: 'trusted-user',
        workspaceId: 'workspace-1',
        resourceScope: {
          fileId: 'trusted-file',
          chatId: 'chat-1',
          executionId: 'execution-1',
        },
      }),
      input: { fileId: 'model-forged-file' },
    })
  })

  it('rejects unregistered and same-ID forged operation objects', () => {
    const executeCopilotUseCase = createAdapter()
    const unregistered = defineWorkspaceOperation({
      id: 'files.unregistered',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['copilot'],
      capability: 'files.use',
    })
    const sameIdDifferentPolicy = defineWorkspaceOperation({
      id: operation.id,
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['copilot'],
      capability: 'files.use',
    })

    expect(() =>
      executeCopilotUseCase(
        trustedContext,
        { operation: unregistered, execute: vi.fn() },
        {},
        { fileId: 'file-1' }
      )
    ).toThrow('Unregistered Copilot file operation')
    expect(() =>
      executeCopilotUseCase(
        trustedContext,
        { operation: sameIdDifferentPolicy, execute: vi.fn() },
        {},
        { fileId: 'file-1' }
      )
    ).toThrow('Unregistered Copilot file operation')
  })

  it('rejects an operation whose delegated identity policy excludes Copilot', () => {
    const executorOperation = defineWorkspaceOperation({
      id: 'files.executor_only',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['executor'],
      capability: 'files.use',
    })
    const execute = vi.fn()
    const executeCopilotUseCase = createCopilotApplicationAdapter<
      WorkspaceOperation,
      FileScopeInput
    >({
      domain: 'file',
      delegation,
      operations: { executorOnly: executorOperation },
      projectResourceScope: ({ fileId }) => ({ fileId }),
    })

    expect(() =>
      executeCopilotUseCase(
        trustedContext,
        { operation: executorOperation, execute },
        {},
        { fileId: 'file-1' }
      )
    ).toThrow('Delegated service copilot cannot perform operation files.executor_only')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a principal factory that changes the configured audience', () => {
    const execute = vi.fn()
    const executeCopilotUseCase = createAdapter(({ context, resourceScope }) => ({
      ...createCopilotApplicationPrincipal(context, { ...delegation, resourceScope }),
      audience: 'sim:forged',
    }))

    expect(() =>
      executeCopilotUseCase(trustedContext, { operation, execute }, {}, { fileId: 'file-1' })
    ).toThrow('configured delegation identity')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an expired principal before application execution', () => {
    const execute = vi.fn()
    const executeCopilotUseCase = createAdapter(({ context, resourceScope }) => {
      const principal = createCopilotApplicationPrincipal(context, {
        ...delegation,
        resourceScope,
      })
      return { ...principal, expiresAt: new Date(principal.issuedAt.getTime() - 1) }
    })

    expect(() =>
      executeCopilotUseCase(trustedContext, { operation, execute }, {}, { fileId: 'file-1' })
    ).toThrow('configured delegation expiry')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a principal factory scoped to a different resource', () => {
    const execute = vi.fn()
    const executeCopilotUseCase = createAdapter(({ context, resourceScope }) => {
      const principal = createCopilotApplicationPrincipal(context, {
        ...delegation,
        resourceScope,
      })
      return { ...principal, resourceScope: { ...principal.resourceScope, fileId: 'file-2' } }
    })

    expect(() =>
      executeCopilotUseCase(trustedContext, { operation, execute }, {}, { fileId: 'file-1' })
    ).toThrow('configured resource scope')
    expect(execute).not.toHaveBeenCalled()
  })
})
