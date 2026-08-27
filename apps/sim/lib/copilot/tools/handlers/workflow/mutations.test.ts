/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    apiKey: vi.fn(),
    executeWorkflowUseCase: vi.fn(),
    hasExecutionResult: vi.fn(),
    readAttemptedExecutionId: vi.fn(),
  },
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: mocks.executeWorkflowUseCase,
  messageForCopilotWorkflowError: (error: unknown, fallback = 'Workflow operation failed') =>
    error instanceof Error && 'code' in error ? error.message : fallback,
}))

vi.mock('@/lib/copilot/application/execute-api-key-use-case', () => ({
  executeCopilotApiKeyUseCase: mocks.apiKey,
}))

vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((state) => state),
}))

vi.mock('@/executor/utils/errors', () => ({
  hasExecutionResult: mocks.hasExecutionResult,
  readAttemptedExecutionId: mocks.readAttemptedExecutionId,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { apiKeyGenerated: vi.fn() },
}))

import {
  executeCancelWorkflowRun,
  executeCreateWorkflow,
  executeGenerateApiKey,
  executeMoveWorkflow,
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
  executeSetGlobalWorkflowVariables,
} from '@/lib/copilot/tools/handlers/workflow/mutations'

const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
  billingAttribution: { workspaceId: 'workspace-1' },
} as ExecutionContext

describe('workflow mutation Copilot adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasExecutionResult.mockReturnValue(false)
    mocks.readAttemptedExecutionId.mockReturnValue(undefined)
  })

  it('maps encoded folder aliases into one create application command', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      workflow: {
        id: 'workflow-new',
        name: 'New Workflow',
        workspaceId: 'workspace-1',
        folderId: 'folder-1',
      },
      normalizedState: { blocks: {}, edges: [], loops: {}, parallels: {} },
    })

    const result = await executeCreateWorkflow(
      { name: ' New Workflow ', folderPath: 'workflows/Launch%20Plans' },
      context
    )

    expect(result.success).toBe(true)
    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ operation: expect.objectContaining({ id: 'workflows.create' }) }),
      {
        workspaceId: 'workspace-1',
        name: 'New Workflow',
        folderPath: '/Launch%20Plans',
      }
    )
  })

  it('rejects a create-workflow workspaceId that names a different workspace', async () => {
    const result = await executeCreateWorkflow(
      { name: 'New Workflow', workspaceId: 'workspace-other' },
      context
    )

    expect(result.success).toBe(false)
    expect(mocks.executeWorkflowUseCase).not.toHaveBeenCalled()
  })

  it('calls the compound variable command once', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({ updated: 2 })
    const operations = [
      { operation: 'add' as const, name: 'threshold', type: 'number', value: '5' },
    ]

    const result = await executeSetGlobalWorkflowVariables(
      { workflowId: 'workflow-1', operations },
      context
    )

    expect(result).toEqual({ success: true, output: { updated: 2 } })
    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledOnce()
    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.variables.apply_operations' }),
      }),
      {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        operations,
      }
    )
  })

  it('projects one run command result without exposing binary payloads', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: { file: { base64: 'secret-bytes', name: 'report.pdf' } },
      logs: [],
      metadata: { executionId: 'execution-1' },
    })

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-1', workflow_input: { query: 'hello' } },
      context
    )

    expect(result).toMatchObject({
      success: true,
      output: {
        executionId: 'execution-1',
        output: { file: { name: 'report.pdf' } },
      },
    })
    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.copilot.run' }),
      }),
      expect.objectContaining({
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
        workflowInput: { query: 'hello' },
        hasWorkflowInput: true,
        lifecycle: expect.objectContaining({ billingAttribution: context.billingAttribution }),
      })
    )
  })

  it('cancels a workflow run through the canonical application use case', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      executionId: 'execution-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })

    const result = await executeCancelWorkflowRun(
      { workflowId: 'workflow-1', executionId: 'execution-1' },
      context
    )

    expect(result).toEqual({
      success: true,
      output: {
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        durablyRecorded: true,
        locallyAborted: false,
        pausedCancelled: false,
        reason: 'recorded',
      },
    })
    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.runs.cancel' }),
      }),
      {
        workflowId: 'workflow-1',
        runId: 'execution-1',
        assertedWorkspaceId: 'workspace-1',
      }
    )
  })

  it('returns a cancellation application error to the Run agent', async () => {
    mocks.executeWorkflowUseCase.mockRejectedValue(
      Object.assign(new Error('Execution cannot be cancelled while completed'), {
        code: 'conflict',
      })
    )

    const result = await executeCancelWorkflowRun(
      { workflowId: 'workflow-1', executionId: 'execution-1' },
      context
    )

    expect(result).toEqual({
      success: false,
      error: 'Execution cannot be cancelled while completed',
    })
  })

  it('requires an execution ID before attempting workflow-run cancellation', async () => {
    const result = await executeCancelWorkflowRun({ workflowId: 'workflow-1' }, context)

    expect(result).toEqual({ success: false, error: 'executionId is required' })
    expect(mocks.executeWorkflowUseCase).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'until',
      operationId: 'workflows.copilot.run_until',
      run: () =>
        executeRunWorkflowUntilBlock(
          { workflowId: 'workflow-1', stopAfterBlockId: 'agent-1', useMockPayload: true },
          context
        ),
      input: expect.objectContaining({ stopAfterBlockId: 'agent-1' }),
    },
    {
      label: 'from block',
      operationId: 'workflows.copilot.run_from_block',
      run: () =>
        executeRunFromBlock(
          {
            workflowId: 'workflow-1',
            startBlockId: 'agent-1',
            executionId: 'source-1',
          },
          context
        ),
      input: expect.objectContaining({ blockId: 'agent-1', sourceExecutionId: 'source-1' }),
    },
    {
      label: 'one block',
      operationId: 'workflows.copilot.run_block',
      run: () =>
        executeRunBlock(
          { workflowId: 'workflow-1', blockId: 'agent-1', executionId: 'source-1' },
          context
        ),
      input: expect.objectContaining({ blockId: 'agent-1', sourceExecutionId: 'source-1' }),
    },
  ])('uses one fixed $label application command', async ({ operationId, run, input }) => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      success: true,
      output: {},
      logs: [],
      metadata: { executionId: 'execution-1' },
    })

    await run()

    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledOnce()
    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ operation: expect.objectContaining({ id: operationId }) }),
      input
    )
  })

  it('passes a bounded move batch to one bulk command', async () => {
    mocks.executeWorkflowUseCase.mockResolvedValue({
      moved: [{ workflowId: 'workflow-1' }],
      failed: [{ workflowId: 'workflow-2', error: 'Workflow is locked' }],
      folderId: 'folder-1',
    })

    const result = await executeMoveWorkflow(
      { workflowIds: ['workflow-1', 'workflow-2'], folderId: 'folder-1' },
      context
    )

    expect(result.success).toBe(true)
    expect(mocks.executeWorkflowUseCase).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.bulk.move' }),
      }),
      {
        workspaceId: 'workspace-1',
        workflowIds: ['workflow-1', 'workflow-2'],
        folderId: 'folder-1',
      }
    )
  })

  it('uses the fixed API-key application command', async () => {
    mocks.apiKey.mockResolvedValue({
      key: { id: 'key-1', name: 'Copilot key', key: 'secret-key' },
    })

    const result = await executeGenerateApiKey({ name: ' Copilot key ' }, context)

    expect(result.success).toBe(true)
    expect(mocks.apiKey).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'api_keys.copilot.create' }),
      }),
      { workspaceId: 'workspace-1', name: 'Copilot key' }
    )
  })

  it('logs the full unknown run failure but returns a generic model-visible error', async () => {
    mocks.executeWorkflowUseCase.mockRejectedValueOnce(new Error('postgres password=secret'))

    const result = await executeRunWorkflow({ workflowId: 'workflow-1' }, context)

    expect(result).toEqual({
      success: false,
      error: 'Workflow execution failed',
      effect: { phase: 'not_attempted' },
    })
  })

  /**
   * How far the run got is the only thing a caller can act on once the egress boundary
   * withholds the payload, so each of these must reach the projection distinguishable.
   */
  it.each([
    {
      label: 'refused on its own arguments',
      arrange: () => {},
      run: () => executeRunWorkflow({}, { ...context, workflowId: undefined }),
      effect: { phase: 'not_attempted' },
    },
    {
      label: 'failed before dispatch',
      arrange: () => mocks.executeWorkflowUseCase.mockRejectedValueOnce(new Error('denied')),
      run: () => executeRunWorkflow({ workflowId: 'workflow-1' }, context),
      effect: { phase: 'not_attempted' },
    },
    {
      label: 'failed after dispatch',
      arrange: () => {
        mocks.executeWorkflowUseCase.mockRejectedValueOnce(new Error('crashed'))
        mocks.readAttemptedExecutionId.mockReturnValue('execution-1')
      },
      run: () => executeRunWorkflow({ workflowId: 'workflow-1' }, context),
      effect: { phase: 'attempted', ids: { executionId: 'execution-1' } },
    },
    {
      label: 'cancelled before it could finish',
      arrange: () =>
        mocks.executeWorkflowUseCase.mockResolvedValueOnce({
          success: false,
          output: {},
          logs: [],
          status: 'cancelled',
          metadata: { executionId: 'execution-1' },
        }),
      run: () => executeRunWorkflow({ workflowId: 'workflow-1' }, context),
      effect: { phase: 'attempted', ids: { executionId: 'execution-1' } },
    },
    {
      label: 'completed',
      arrange: () =>
        mocks.executeWorkflowUseCase.mockResolvedValueOnce({
          success: true,
          output: {},
          logs: [],
          metadata: { executionId: 'execution-1' },
        }),
      run: () => executeRunWorkflow({ workflowId: 'workflow-1' }, context),
      effect: { phase: 'performed', ids: { executionId: 'execution-1' } },
    },
  ])('states that a run $label', async ({ arrange, run, effect }) => {
    arrange()
    expect((await run()).effect).toEqual(effect)
  })
})
