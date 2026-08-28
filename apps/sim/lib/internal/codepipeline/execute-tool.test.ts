/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeCodepipelineDisableStageTransition: vi.fn(),
  executeCodepipelineEnableStageTransition: vi.fn(),
  executeCodepipelineGetPipeline: vi.fn(),
  executeCodepipelineGetPipelineExecution: vi.fn(),
  executeCodepipelineGetPipelineState: vi.fn(),
  executeCodepipelineListActionExecutions: vi.fn(),
  executeCodepipelineListPipelineExecutions: vi.fn(),
  executeCodepipelineListPipelines: vi.fn(),
  executeCodepipelinePutApprovalResult: vi.fn(),
  executeCodepipelineRetryStageExecution: vi.fn(),
  executeCodepipelineStartExecution: vi.fn(),
  executeCodepipelineStopExecution: vi.fn(),
}))

vi.mock('@/lib/internal/codepipeline/operations', () => mockOperations)

import { executeCodepipelineTool } from '@/lib/internal/codepipeline/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'codepipeline_list_pipelines',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const PIPELINE = { ...CONNECTION, pipelineName: 'pipeline' }
const EXECUTION = { ...PIPELINE, pipelineExecutionId: 'execution-id' }

const TOOL_CASES = [
  [
    'codepipeline_disable_stage_transition',
    {
      ...PIPELINE,
      stageName: 'Deploy',
      transitionType: 'Inbound',
      reason: 'maintenance',
    },
    mockOperations.executeCodepipelineDisableStageTransition,
  ],
  [
    'codepipeline_enable_stage_transition',
    { ...PIPELINE, stageName: 'Deploy', transitionType: 'Outbound' },
    mockOperations.executeCodepipelineEnableStageTransition,
  ],
  [
    'codepipeline_get_pipeline_execution',
    EXECUTION,
    mockOperations.executeCodepipelineGetPipelineExecution,
  ],
  ['codepipeline_get_pipeline_state', PIPELINE, mockOperations.executeCodepipelineGetPipelineState],
  ['codepipeline_get_pipeline', PIPELINE, mockOperations.executeCodepipelineGetPipeline],
  [
    'codepipeline_list_action_executions',
    PIPELINE,
    mockOperations.executeCodepipelineListActionExecutions,
  ],
  [
    'codepipeline_list_pipeline_executions',
    PIPELINE,
    mockOperations.executeCodepipelineListPipelineExecutions,
  ],
  ['codepipeline_list_pipelines', CONNECTION, mockOperations.executeCodepipelineListPipelines],
  [
    'codepipeline_put_approval_result',
    {
      ...PIPELINE,
      stageName: 'Approval',
      actionName: 'Approve',
      token: 'approval-token',
      status: 'Approved',
      summary: 'approved',
    },
    mockOperations.executeCodepipelinePutApprovalResult,
  ],
  [
    'codepipeline_retry_stage_execution',
    { ...EXECUTION, stageName: 'Deploy', retryMode: 'FAILED_ACTIONS' },
    mockOperations.executeCodepipelineRetryStageExecution,
  ],
  ['codepipeline_start_execution', PIPELINE, mockOperations.executeCodepipelineStartExecution],
  ['codepipeline_stop_execution', EXECUTION, mockOperations.executeCodepipelineStopExecution],
] as const

describe('executeCodepipelineTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeCodepipelineTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeCodepipelineTool(createRequest({ input: { region: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeCodepipelineListPipelines).not.toHaveBeenCalled()
  })

  it('preserves AWS client status and the provider error envelope', async () => {
    const error = Object.assign(new Error('Pipeline missing'), {
      $metadata: { httpStatusCode: 404 },
    })
    mockOperations.executeCodepipelineListPipelines.mockRejectedValue(error)

    const response = await executeCodepipelineTool(createRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to list CodePipeline pipelines: Pipeline missing',
    })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeCodepipelineTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeCodepipelineListPipelines).not.toHaveBeenCalled()
  })
})
