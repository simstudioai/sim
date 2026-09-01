/**
 * @vitest-environment node
 */

import {
  bindPrincipalExecutionMetadata,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'

const { mockBindRuntimeWorkflowExecutionPrincipal } = vi.hoisted(() => ({
  mockBindRuntimeWorkflowExecutionPrincipal: vi.fn(),
}))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindRuntimeWorkflowExecutionPrincipal: mockBindRuntimeWorkflowExecutionPrincipal,
}))

import {
  createExecutorPrincipalFromExecutionContext,
  requireExecutorWorkspaceId,
} from '@/lib/internal/principals/executor'

function runtimePrincipal(principal: WorkflowExecutionPrincipal) {
  return bindPrincipalExecutionMetadata(principal, {
    executionId: 'execution-1',
    rootWorkflowId: 'workflow-1',
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'deployment-version-1',
    },
  })
}

function executionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    workspaceId: 'workspace-1',
    userId: 'legacy-execution-user',
    principal: runtimePrincipal({
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }),
    ...overrides,
  } as ExecutionContext
}

describe('createExecutorPrincipalFromExecutionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBindRuntimeWorkflowExecutionPrincipal.mockImplementation(async (principal) => principal)
  })

  it('revalidates and returns the same semantic runtime principal', async () => {
    const principal = runtimePrincipal({
      kind: 'session',
      userId: 'user-origin',
      sessionId: 'session-origin',
    })

    await expect(
      createExecutorPrincipalFromExecutionContext({ context: executionContext({ principal }) })
    ).resolves.toBe(principal)
    expect(mockBindRuntimeWorkflowExecutionPrincipal).toHaveBeenCalledWith(principal, undefined)
  })

  it.each([
    {
      name: 'schedule',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
    },
    {
      name: 'workspace API key',
      principal: {
        kind: 'workspace_api_key' as const,
        workspaceId: 'workspace-1',
        keyId: 'workspace-key-1',
      },
    },
  ])(
    'preserves the $name principal while carrying legacy attribution separately',
    async (entry) => {
      const principal = runtimePrincipal(entry.principal)

      await createExecutorPrincipalFromExecutionContext({
        context: executionContext({ principal }),
      })

      expect(mockBindRuntimeWorkflowExecutionPrincipal).toHaveBeenCalledWith(principal, {
        compatibilityActorUserId: 'legacy-execution-user',
      })
    }
  )

  it('does not substitute the execution user for a verified external subject', async () => {
    const principal = runtimePrincipal({
      kind: 'system',
      serviceId: 'webhook',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      provider: 'slack',
      subject: {
        kind: 'external_user',
        provider: 'slack',
        tenantId: 'team-1',
        subjectId: 'external-user-1',
      },
    })

    await createExecutorPrincipalFromExecutionContext({
      context: executionContext({ principal }),
    })

    expect(mockBindRuntimeWorkflowExecutionPrincipal).toHaveBeenCalledWith(principal, undefined)
  })

  it('fails closed without the runtime principal', async () => {
    await expect(
      createExecutorPrincipalFromExecutionContext({
        context: executionContext({ principal: undefined }),
      })
    ).rejects.toThrow('Workflow execution principal is required')
    expect(mockBindRuntimeWorkflowExecutionPrincipal).not.toHaveBeenCalled()
  })

  it('fails closed when the runtime principal lacks execution metadata', async () => {
    await expect(
      createExecutorPrincipalFromExecutionContext({
        context: executionContext({
          principal: {
            kind: 'session',
            userId: 'user-1',
            sessionId: 'session-1',
          },
        }),
      })
    ).rejects.toThrow('missing execution metadata')
    expect(mockBindRuntimeWorkflowExecutionPrincipal).not.toHaveBeenCalled()
  })
})

describe('requireExecutorWorkspaceId', () => {
  it('returns the explicitly transported workspace assertion', () => {
    expect(requireExecutorWorkspaceId({ workspaceId: 'workspace-1' })).toBe('workspace-1')
  })

  it.each([undefined, '', '   '])('fails closed for invalid workspace %s', (workspaceId) => {
    expect(() => requireExecutorWorkspaceId({ workspaceId })).toThrow(
      'Workflow execution workspace is required'
    )
  })
})
