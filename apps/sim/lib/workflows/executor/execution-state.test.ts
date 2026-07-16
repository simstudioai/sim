/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaterializeExecutionData, mockSelect } = vi.hoisted(() => ({
  mockMaterializeExecutionData: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockSelect },
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionData: mockMaterializeExecutionData,
  TRACE_STORE_REF_KEY: 'traceStoreRef',
}))

import {
  getExecutionInputForWorkflow,
  getExecutionStateForWorkflow,
  getLatestExecutionStateWithExecutionId,
} from '@/lib/workflows/executor/execution-state'

const EXECUTION_STATE = {
  blockStates: {},
  executedBlocks: ['block-1'],
  blockLogs: [],
  decisions: {},
  completedLoops: [],
  activeExecutionPath: [],
}

function createSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.orderBy.mockReturnValue(chain)
  return chain
}

describe('execution state lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMaterializeExecutionData.mockReset()
    mockSelect.mockReset()
  })

  it('materializes externalized execution data for a specific execution', async () => {
    const slimExecutionData = {
      traceStoreRef: {
        __simLargeValueRef: true,
        id: 'value-1',
        key: 'execution/workspace-1/workflow-1/execution-1/value.json',
        kind: 'object',
        size: 100,
        version: 1,
        executionId: 'execution-1',
      },
    }
    mockSelect.mockReturnValueOnce(
      createSelectChain([
        {
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          executionData: slimExecutionData,
        },
      ])
    )
    mockMaterializeExecutionData.mockResolvedValueOnce({
      executionState: EXECUTION_STATE,
    })

    const result = await getExecutionStateForWorkflow('execution-1', 'workflow-1')

    expect(mockMaterializeExecutionData).toHaveBeenCalledWith(slimExecutionData, {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(result).toEqual(EXECUTION_STATE)
  })

  it('materializes externalized execution data when reusing workflow input', async () => {
    const slimExecutionData = {
      traceStoreRef: {
        __simLargeValueRef: true,
        id: 'value-1',
        key: 'execution/workspace-1/workflow-1/execution-1/value.json',
        kind: 'object',
        size: 100,
        version: 1,
        executionId: 'execution-1',
      },
    }
    mockSelect.mockReturnValueOnce(
      createSelectChain([
        {
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          executionData: slimExecutionData,
        },
      ])
    )
    mockMaterializeExecutionData.mockResolvedValueOnce({
      workflowInput: { leadId: 'lead-1' },
    })

    const result = await getExecutionInputForWorkflow('execution-1', 'workflow-1')

    expect(result).toEqual({
      found: true,
      input: { leadId: 'lead-1' },
    })
    expect(mockMaterializeExecutionData).toHaveBeenCalledWith(slimExecutionData, {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('checks older pointer-backed candidates when the latest has no execution state', async () => {
    mockSelect.mockReturnValueOnce(
      createSelectChain([
        {
          executionId: 'execution-2',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          executionState: null,
          traceStoreRef: { id: 'value-2' },
        },
        {
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          executionState: null,
          traceStoreRef: { id: 'value-1' },
        },
      ])
    )
    mockMaterializeExecutionData
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ executionState: EXECUTION_STATE })

    const result = await getLatestExecutionStateWithExecutionId('workflow-1')

    expect(result).toEqual({
      executionId: 'execution-1',
      state: EXECUTION_STATE,
    })
    expect(mockMaterializeExecutionData).toHaveBeenCalledTimes(2)
    expect(mockMaterializeExecutionData).toHaveBeenNthCalledWith(
      1,
      {
        executionState: null,
        traceStoreRef: { id: 'value-2' },
      },
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-2',
      }
    )
  })
})
