/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGenerateId,
  mockPreprocessExecution,
  mockReleaseExecutionSlot,
  mockLoadDeployed,
  mockLoadVersion,
  mockHasHitl,
  mockExecuteWorkflowCore,
  mockValidateOutputs,
  mockHandlePauseState,
  mockWaitForPostExecution,
  mockMarkAsFailed,
} = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
  mockPreprocessExecution: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockLoadDeployed: vi.fn(),
  mockLoadVersion: vi.fn(),
  mockHasHitl: vi.fn(),
  mockExecuteWorkflowCore: vi.fn(),
  mockValidateOutputs: vi.fn(),
  mockHandlePauseState: vi.fn(),
  mockWaitForPostExecution: vi.fn(),
  mockMarkAsFailed: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({ generateId: mockGenerateId }))
vi.mock('@/lib/execution/preprocessing', () => ({ preprocessExecution: mockPreprocessExecution }))
vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mockLoadDeployed,
  loadWorkflowDeploymentVersionState: mockLoadVersion,
}))
vi.mock('@/lib/interfaces/spec/validate', () => ({ workflowHasHitlBlocks: mockHasHitl }))
vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
}))
vi.mock('@/lib/apps/schema-validate', () => ({ validateAppActionOutputs: mockValidateOutputs }))
vi.mock('@/lib/interfaces/compiler/output-response', () => ({
  sanitizePublicValue: (value: unknown) => value,
}))
vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: mockHandlePauseState,
}))
vi.mock('@/lib/core/execution-limits', () => ({
  createTimeoutAbortController: () => ({
    signal: new AbortController().signal,
    abort: vi.fn(),
    cleanup: vi.fn(),
    isTimedOut: () => false,
    timeoutMs: 30_000,
  }),
  getTimeoutErrorMessage: () => 'Timed out',
}))
vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    markAsFailed = mockMarkAsFailed
    waitForPostExecution = mockWaitForPostExecution
  },
}))
vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: class {
    constructor(
      public metadata: unknown,
      public workflow: unknown,
      public input: unknown
    ) {}
  },
}))

import { executeDeployedAction } from '@/lib/apps/execute-deployed-action'

const deployed = {
  blocks: { start: { type: 'starter' }, result: { type: 'function' } },
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
  deploymentVersionId: 'dv-1',
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'wf-1',
    userId: 'owner-1',
    workspaceId: 'ws-1',
    deploymentGate: 'pinned' as const,
    deploymentVersionId: 'dv-1',
    input: { name: 'Ada' },
    outputConfigs: [],
    executionPolicy: 'sync' as const,
    triggerIdentity: 'app' as const,
    requestId: 'req-1',
    ...overrides,
  }
}

describe('executeDeployedAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateId.mockReturnValue('execution-1')
    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-1',
      billingAttribution: { source: 'workspace' },
      workflowRecord: {
        userId: 'owner-1',
        workspaceId: 'ws-1',
        archivedAt: null,
        variables: {},
      },
      executionTimeout: { sync: 30_000 },
    })
    mockLoadVersion.mockResolvedValue(deployed)
    mockHasHitl.mockReturnValue(false)
    mockExecuteWorkflowCore.mockResolvedValue({
      success: true,
      status: 'completed',
      logs: [],
    })
    mockValidateOutputs.mockReturnValue({ ok: true })
    mockHandlePauseState.mockResolvedValue(undefined)
    mockWaitForPostExecution.mockResolvedValue(undefined)
    mockReleaseExecutionSlot.mockResolvedValue(undefined)
  })

  it('loads the pinned deployment version and skips the active deployment check', async () => {
    const result = await executeDeployedAction(params())

    expect(result.success).toBe(true)
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-1', checkDeployment: false })
    )
    expect(mockLoadVersion).toHaveBeenCalledWith('wf-1', 'dv-1', 'ws-1')
    expect(mockLoadDeployed).not.toHaveBeenCalled()
  })

  it('rejects an archived workflow before loading the pinned deployment', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      billingAttribution: {},
      workflowRecord: { userId: 'owner-1', archivedAt: new Date() },
    })

    await expect(executeDeployedAction(params())).resolves.toEqual({
      success: false,
      statusCode: 404,
      message: 'Workflow is not available',
    })
    expect(mockLoadVersion).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it('rejects async execution policy before preprocessing', async () => {
    await expect(
      executeDeployedAction(params({ executionPolicy: 'async' }))
    ).resolves.toEqual({
      success: false,
      statusCode: 400,
      code: 'ASYNC_NOT_SUPPORTED',
      message: 'Async execution is not available yet',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('rejects workflows containing HITL blocks', async () => {
    mockHasHitl.mockReturnValueOnce(true)

    await expect(executeDeployedAction(params())).resolves.toEqual({
      success: false,
      statusCode: 400,
      code: 'HITL_NOT_SUPPORTED',
      message: 'Human-in-the-loop workflows are not supported on this execution path',
    })
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it('projects named outputs from block log paths', async () => {
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      logs: [
        { blockId: 'result', output: { profile: { name: 'Ada', role: 'engineer' } } },
        { blockId: 'other', output: { count: 3 } },
      ],
    })

    const result = await executeDeployedAction(
      params({
        outputConfigs: [
          { key: 'name', blockId: 'result', path: 'profile.name' },
          { key: 'count', blockId: 'other', path: 'count' },
        ],
      })
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        executionId: 'execution-1',
        outputs: { name: 'Ada', count: 3 },
      })
    )
  })
})
