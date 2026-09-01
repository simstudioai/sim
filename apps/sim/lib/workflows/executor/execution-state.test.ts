/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMaterializeExecutionData } = vi.hoisted(() => ({
  mockMaterializeExecutionData: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionData: mockMaterializeExecutionData,
  TRACE_STORE_REF_KEY: 'traceStoreRef',
}))

import {
  getExecutionInputForWorkflow,
  getExecutionStateForWorkflow,
  getLatestExecutionStateWithExecutionId,
  getTrustedWorkflowToolExecution,
} from '@/lib/workflows/executor/execution-state'

const EXECUTION_STATE = {
  blockStates: {},
  executedBlocks: ['block-1'],
  blockLogs: [],
  decisions: {},
  completedLoops: [],
  activeExecutionPath: [],
}

describe('execution state lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockMaterializeExecutionData.mockReset()
  })

  afterAll(() => {
    resetDbChainMock()
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
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionData: slimExecutionData,
      },
    ])
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

  it('loads a terminal workflow result with an exact persisted Copilot binding', async () => {
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      correlation: { copilotToolCallId: 'tool-call-1' },
      finalOutput: { token: 'raw-secret' },
      executionState: { ...EXECUTION_STATE, resolvedSecretTraceProvenance: provenance },
    })

    await expect(
      getTrustedWorkflowToolExecution('execution-1', 'workflow-1', 'tool-call-1')
    ).resolves.toEqual({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'completed',
      contentAvailable: true,
      finalOutput: { token: 'raw-secret' },
      blockLogs: [],
      provenance,
    })
  })

  it('accepts a bound complete execution with no activated secrets', async () => {
    const provenance = { version: 1 as const, complete: true, entries: [] }
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      trigger: { data: { correlation: { copilotToolCallId: 'tool-call-1' } } },
      executionState: { ...EXECUTION_STATE, resolvedSecretTraceProvenance: provenance },
    })

    await expect(
      getTrustedWorkflowToolExecution('execution-1', 'workflow-1', 'tool-call-1')
    ).resolves.toMatchObject({ provenance })
  })

  it('returns validated incomplete provenance so the terminal projector can fail closed', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'failed',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      correlation: { copilotToolCallId: 'tool-call-1' },
      executionState: {
        ...EXECUTION_STATE,
        resolvedSecretTraceProvenance: { version: 1, complete: false, entries: [] },
      },
    })

    await expect(
      getTrustedWorkflowToolExecution('execution-1', 'workflow-1', 'tool-call-1')
    ).resolves.toMatchObject({
      status: 'failed',
      provenance: { version: 1, complete: false, entries: [] },
    })
  })

  it('trusts compacted terminal status while withholding unavailable execution content', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      correlation: { copilotToolCallId: 'tool-call-1' },
      executionStateSummary: {
        executedBlockCount: 1,
        blockLogCount: 1,
        completedLoopCount: 0,
        activeExecutionPathLength: 0,
        pendingQueueLength: 0,
      },
      finalOutput: { token: 'must-not-cross' },
    })

    await expect(
      getTrustedWorkflowToolExecution('execution-1', 'workflow-1', 'tool-call-1')
    ).resolves.toEqual({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'completed',
      contentAvailable: false,
    })
  })

  it('withholds execution content when persisted provenance is malformed', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      correlation: { copilotToolCallId: 'tool-call-1' },
      finalOutput: { token: 'must-not-cross' },
      executionState: {
        ...EXECUTION_STATE,
        resolvedSecretTraceProvenance: { version: 2, complete: true, entries: [] },
      },
    })

    await expect(
      getTrustedWorkflowToolExecution('execution-1', 'workflow-1', 'tool-call-1')
    ).resolves.toEqual({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'completed',
      contentAvailable: false,
    })
  })

  it('rejects mismatched bindings and nonterminal rows', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'completed',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      correlation: { copilotToolCallId: 'another-tool-call' },
      executionState: {
        ...EXECUTION_STATE,
        resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
      },
    })

    await expect(
      getTrustedWorkflowToolExecution('execution-1', 'workflow-1', 'tool-call-1')
    ).resolves.toBeNull()

    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-2',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        status: 'running',
        executionData: {},
      },
    ])

    await expect(
      getTrustedWorkflowToolExecution('execution-2', 'workflow-1', 'tool-call-1')
    ).resolves.toBeNull()
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
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionData: slimExecutionData,
      },
    ])
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

  it('recovers legacy workflow input from the pre-populated starter block state', async () => {
    const legacyInput = { leadId: 'legacy-lead' }
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      executionState: {
        blockStates: {
          'executed-block': {
            output: { leadId: 'wrong-lead' },
            executed: true,
            executionTime: 10,
          },
          start: {
            output: legacyInput,
            executed: false,
            executionTime: 0,
          },
        },
      },
    })

    const result = await getExecutionInputForWorkflow('execution-1', 'workflow-1')

    expect(result).toEqual({ found: true, input: legacyInput })
  })

  it('prefers persisted workflow input over the legacy starter block state', async () => {
    const workflowInput = { leadId: 'current-lead' }
    queueTableRows(schemaMock.workflowExecutionLogs, [
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionData: {},
      },
    ])
    mockMaterializeExecutionData.mockResolvedValueOnce({
      workflowInput,
      executionState: {
        blockStates: {
          start: {
            output: { leadId: 'legacy-lead' },
            executed: false,
            executionTime: 0,
          },
        },
      },
    })

    const result = await getExecutionInputForWorkflow('execution-1', 'workflow-1')

    expect(result).toEqual({ found: true, input: workflowInput })
  })

  it('checks older pointer-backed candidates when the latest has no execution state', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [
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
    mockMaterializeExecutionData
      .mockResolvedValueOnce({})
      .mockImplementationOnce(async (executionData: Record<string, unknown>) => {
        const { traceStoreRef: _traceStoreRef, ...inlineValues } = executionData
        return { executionState: EXECUTION_STATE, ...inlineValues }
      })

    const result = await getLatestExecutionStateWithExecutionId('workflow-1')

    expect(result).toEqual({
      executionId: 'execution-1',
      state: EXECUTION_STATE,
    })
    expect(mockMaterializeExecutionData).toHaveBeenCalledTimes(2)
    expect(mockMaterializeExecutionData).toHaveBeenNthCalledWith(
      1,
      {
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
