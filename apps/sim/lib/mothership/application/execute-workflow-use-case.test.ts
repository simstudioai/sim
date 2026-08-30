/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/workflows/application/resolve-workflow-outputs', () => ({
  resolveWorkflowOutputs: { execute: mocks.execute },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  executeCopilotResolveWorkflowOutputs,
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/mothership/application/execute-workflow-use-case'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/mothership/constants'
import { workflowOperations } from '@/lib/workflows/application/operations'

const trustedContext = {
  userId: 'trusted-user',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

describe('Copilot Workflow application adapter', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('enters the fixed Workflow resolver with trusted Copilot identity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mocks.execute.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      outputs: null,
      executionOrderByBlockId: {},
    })

    await expect(
      executeCopilotResolveWorkflowOutputs(trustedContext, {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
      })
    ).resolves.toMatchObject({ workflowId: 'workflow-1' })

    expect(mocks.execute).toHaveBeenCalledWith({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'trusted-user',
        workspaceId: 'workspace-1',
        delegationId: 'copilot-tool:tool-call-1',
        audience: 'sim:workflows',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date(Date.now() + ORCHESTRATION_TIMEOUT_MS),
        resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
      },
      input: { workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' },
    })
  })

  it('derives identity only from trusted adapter context', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })
    const useCase = { operation: workflowOperations.update, execute }

    await expect(
      executeCopilotWorkflowUseCase(trustedContext, useCase, {
        workflowId: 'workflow-1',
        userId: 'forged-user',
      })
    ).resolves.toEqual({ ok: true })

    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        subjectUserId: 'trusted-user',
        workspaceId: 'workspace-1',
        audience: 'sim:workflows',
        resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
      }),
      input: { workflowId: 'workflow-1', userId: 'forged-user' },
    })
  })

  it('supports workspace-scoped operations without inventing workflow scope', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })
    await executeCopilotWorkflowUseCase(
      trustedContext,
      { operation: workflowOperations.create, execute },
      { workspaceId: 'workspace-1', name: 'New workflow' }
    )

    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
      }),
      input: { workspaceId: 'workspace-1', name: 'New workflow' },
    })
  })

  it('rejects forged contexts and unregistered operations before execution', () => {
    const execute = vi.fn()
    expect(() =>
      executeCopilotWorkflowUseCase(
        { ...trustedContext, copilotToolExecution: false },
        { operation: workflowOperations.read, execute },
        { workflowId: 'workflow-1' }
      )
    ).toThrow('trusted Copilot execution context')

    expect(() =>
      executeCopilotWorkflowUseCase(
        trustedContext,
        {
          operation: { ...workflowOperations.read, id: 'workflows.unregistered' },
          execute,
        },
        { workflowId: 'workflow-1' }
      )
    ).toThrow('Unregistered Copilot workflow operation')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects untrusted context before fixed Workflow application execution', () => {
    expect(() =>
      executeCopilotResolveWorkflowOutputs(
        { ...trustedContext, copilotToolExecution: false },
        { workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' }
      )
    ).toThrow('trusted Copilot execution context')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('presents typed application errors and conceals unknown causes', () => {
    expect(
      messageForCopilotWorkflowError(new OrchestrationError('forbidden', 'Access denied'))
    ).toBe('Access denied')
    expect(messageForCopilotWorkflowError(new Error('database password'))).toBe(
      'Workflow operation failed'
    )
  })
})
