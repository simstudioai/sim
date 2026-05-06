/**
 * @vitest-environment node
 */
import { resetTerminalConsoleMock, terminalConsoleMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addExecutionErrorConsoleEntry,
  createBlockEventHandlers,
  handleExecutionErrorConsole,
  reconcileFinalBlockLogs,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import type { BlockLog } from '@/executor/types'
import { useExecutionStore } from '@/stores/execution'

describe('workflow-execution-utils', () => {
  beforeEach(() => {
    resetTerminalConsoleMock()
    vi.mocked(useExecutionStore.getState).mockReturnValue({
      getCurrentExecutionId: vi.fn(() => 'exec-1'),
    } as any)
  })

  describe('createBlockEventHandlers', () => {
    it('skips duplicate block start rows during reconnect replay', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'fn-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 7,
        isRunning: false,
        success: true,
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
        childWorkflowBlockId: 'child-inst-1',
        childWorkflowName: 'Child Workflow',
        parentIterations: [
          {
            iterationCurrent: 1,
            iterationTotal: 3,
            iterationType: 'parallel',
            iterationContainerId: 'parallel-1',
          },
        ],
      })

      const addConsole = vi.fn()
      const handlers = createBlockEventHandlers(
        {
          workflowId: 'wf-1',
          executionIdRef: { current: 'exec-1' },
          workflowEdges: [],
          activeBlocksSet: new Set<string>(),
          activeBlockRefCounts: new Map<string, number>(),
          accumulatedBlockLogs: [],
          accumulatedBlockStates: new Map(),
          executedBlockIds: new Set<string>(),
          includeStartConsoleEntry: true,
        },
        {
          addConsole,
          updateConsole: vi.fn(),
          setActiveBlocks: vi.fn(),
          setBlockRunStatus: vi.fn(),
          setEdgeRunStatus: vi.fn(),
        }
      )

      handlers.onBlockStarted({
        blockId: 'fn-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 7,
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
        childWorkflowBlockId: 'child-inst-1',
        childWorkflowName: 'Child Workflow',
        parentIterations: [
          {
            iterationCurrent: 1,
            iterationTotal: 3,
            iterationType: 'parallel',
            iterationContainerId: 'parallel-1',
          },
        ],
      })

      expect(addConsole).not.toHaveBeenCalled()
    })

    it('keeps distinct start rows when replay identity differs', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'fn-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 7,
        isRunning: true,
        iterationCurrent: 0,
        iterationTotal: 2,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
      })

      const addConsole = vi.fn()
      const handlers = createBlockEventHandlers(
        {
          workflowId: 'wf-1',
          executionIdRef: { current: 'exec-1' },
          workflowEdges: [],
          activeBlocksSet: new Set<string>(),
          activeBlockRefCounts: new Map<string, number>(),
          accumulatedBlockLogs: [],
          accumulatedBlockStates: new Map(),
          executedBlockIds: new Set<string>(),
          includeStartConsoleEntry: true,
        },
        {
          addConsole,
          updateConsole: vi.fn(),
          setActiveBlocks: vi.fn(),
          setBlockRunStatus: vi.fn(),
          setEdgeRunStatus: vi.fn(),
        }
      )

      handlers.onBlockStarted({
        blockId: 'fn-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionOrder: 7,
        iterationCurrent: 1,
        iterationTotal: 2,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
      })

      expect(addConsole).toHaveBeenCalledTimes(1)
    })

    it('replays early child workflow instance updates after the start row is added', () => {
      const updateConsole = vi.fn()
      const handlers = createBlockEventHandlers(
        {
          workflowId: 'wf-1',
          executionIdRef: { current: 'exec-1' },
          workflowEdges: [],
          activeBlocksSet: new Set<string>(),
          activeBlockRefCounts: new Map<string, number>(),
          accumulatedBlockLogs: [],
          accumulatedBlockStates: new Map(),
          executedBlockIds: new Set<string>(),
          includeStartConsoleEntry: true,
        },
        {
          addConsole: terminalConsoleMockFns.mockAddConsole as any,
          updateConsole,
          setActiveBlocks: vi.fn(),
          setBlockRunStatus: vi.fn(),
          setEdgeRunStatus: vi.fn(),
        }
      )

      handlers.onBlockChildWorkflowStarted({
        blockId: 'nested-workflow',
        childWorkflowInstanceId: 'nested-inst-1',
        executionOrder: 4,
        childWorkflowBlockId: 'parent-inst-1',
        childWorkflowName: 'Parent Workflow',
      })
      handlers.onBlockStarted({
        blockId: 'nested-workflow',
        blockName: 'Nested Workflow',
        blockType: 'workflow',
        executionOrder: 4,
        childWorkflowBlockId: 'parent-inst-1',
        childWorkflowName: 'Parent Workflow',
      })

      expect(updateConsole).toHaveBeenCalledTimes(2)
      expect(updateConsole.mock.calls[1]).toEqual([
        'nested-workflow',
        expect.objectContaining({
          childWorkflowInstanceId: 'nested-inst-1',
          childWorkflowBlockId: 'parent-inst-1',
          childWorkflowName: 'Parent Workflow',
          executionOrder: 4,
        }),
        'exec-1',
      ])
    })
  })

  describe('addExecutionErrorConsoleEntry', () => {
    it('adds a Run Error entry when no block-level error exists', () => {
      const addConsole = vi.fn()
      addExecutionErrorConsoleEntry(addConsole, {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        error: 'Run failed',
        durationMs: 1234,
        blockLogs: [],
      })

      expect(addConsole).toHaveBeenCalledTimes(1)
      const entry = addConsole.mock.calls[0][0]
      expect(entry.blockName).toBe('Run Error')
      expect(entry.blockType).toBe('error')
      expect(entry.error).toBe('Run failed')
    })

    it('skips when blockLogs already contain a block-level error', () => {
      const addConsole = vi.fn()
      addExecutionErrorConsoleEntry(addConsole, {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        error: 'Run failed',
        blockLogs: [
          {
            blockId: 'b1',
            blockName: 'Function',
            blockType: 'function',
            success: false,
            error: 'JSON parse failed',
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            executionOrder: 1,
            durationMs: 10,
          } as any,
        ],
      })

      expect(addConsole).not.toHaveBeenCalled()
    })

    it('skips when console store already has a block-level error for this execution (Fix D)', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'fetchAshbyData',
        blockName: 'fetchAshbyData',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        success: false,
        error: 'Failed to parse response as JSON',
      })

      const addConsole = vi.fn()
      addExecutionErrorConsoleEntry(addConsole, {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        error: 'Run failed',
        blockLogs: [],
      })

      expect(addConsole).not.toHaveBeenCalled()
    })

    it('still adds when only existing entries are themselves Run Error rows', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'execution-error',
        blockName: 'Run Error',
        blockType: 'error',
        executionId: 'exec-1',
        executionOrder: Number.MAX_SAFE_INTEGER,
        success: false,
        error: 'previous unrelated error',
      })

      const addConsole = vi.fn()
      addExecutionErrorConsoleEntry(addConsole, {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        error: 'New run failed',
        blockLogs: [],
      })

      expect(addConsole).toHaveBeenCalledTimes(1)
    })

    it('uses Timeout Error label when error indicates a timeout', () => {
      const addConsole = vi.fn()
      addExecutionErrorConsoleEntry(addConsole, {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        error: 'Workflow execution timed out after 5m',
        blockLogs: [],
      })

      expect(addConsole).toHaveBeenCalledTimes(1)
      expect(addConsole.mock.calls[0][0].blockName).toBe('Timeout Error')
    })

    it('uses Workflow Validation label when isPreExecutionError is true', () => {
      const addConsole = vi.fn()
      addExecutionErrorConsoleEntry(addConsole, {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        error: 'Invalid block reference',
        blockLogs: [],
        isPreExecutionError: true,
      })

      expect(addConsole).toHaveBeenCalledTimes(1)
      expect(addConsole.mock.calls[0][0].blockName).toBe('Workflow Validation')
    })
  })

  describe('reconcileFinalBlockLogs', () => {
    const makeLog = (over: Partial<BlockLog>): BlockLog => ({
      blockId: 'b1',
      blockName: 'Function',
      blockType: 'function',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 50,
      success: true,
      executionOrder: 1,
      ...over,
    })

    it('flips a still-running entry to the server-reported success state', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'kb-1',
        blockName: 'Knowledge 1',
        blockType: 'knowledge',
        executionId: 'exec-1',
        executionOrder: 2,
        isRunning: true,
      })

      const updateConsole = vi.fn()
      reconcileFinalBlockLogs(updateConsole, 'wf-1', 'exec-1', [
        makeLog({
          blockId: 'kb-1',
          blockName: 'Knowledge 1',
          blockType: 'knowledge',
          executionOrder: 2,
          success: true,
          output: { items: [] },
        }),
      ])

      expect(updateConsole).toHaveBeenCalledTimes(1)
      const [blockId, update, executionId] = updateConsole.mock.calls[0]
      expect(blockId).toBe('kb-1')
      expect(executionId).toBe('exec-1')
      expect(update).toMatchObject({
        success: true,
        isRunning: false,
        replaceOutput: { items: [] },
      })
    })

    it('flips a still-running entry to the server-reported error state (Bug 1 reconciliation)', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'fn-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 3,
        isRunning: true,
      })

      const updateConsole = vi.fn()
      reconcileFinalBlockLogs(updateConsole, 'wf-1', 'exec-1', [
        makeLog({
          blockId: 'fn-1',
          executionOrder: 3,
          success: false,
          error: 'JSON parse failed',
        }),
      ])

      expect(updateConsole).toHaveBeenCalledTimes(1)
      expect(updateConsole.mock.calls[0][1]).toMatchObject({
        success: false,
        error: 'JSON parse failed',
        isRunning: false,
      })
    })

    it('skips entries that are not running', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'fn-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: false,
        success: true,
      })

      const updateConsole = vi.fn()
      reconcileFinalBlockLogs(updateConsole, 'wf-1', 'exec-1', [makeLog({ blockId: 'fn-1' })])

      expect(updateConsole).not.toHaveBeenCalled()
    })

    it('reconciles child workflow spans before running entries are swept to canceled', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'workflow-1',
        blockName: 'Workflow 1',
        blockType: 'workflow',
        executionId: 'exec-1',
        executionOrder: 2,
        isRunning: false,
        success: true,
        childWorkflowInstanceId: 'child-inst-1',
      })
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'starter',
        blockName: 'Start',
        blockType: 'starter',
        executionId: 'exec-1',
        executionOrder: 3,
        isRunning: true,
        childWorkflowBlockId: 'workflow-1',
        childWorkflowName: 'Workflow 1',
      })
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'api-1',
        blockName: 'API 1',
        blockType: 'api',
        executionId: 'exec-1',
        executionOrder: 4,
        isRunning: true,
        childWorkflowBlockId: 'child-inst-1',
        childWorkflowName: 'Workflow 1',
      })

      const startedAt = new Date().toISOString()
      const endedAt = new Date(Date.now() + 20).toISOString()
      const updateConsole = vi.fn()
      reconcileFinalBlockLogs(updateConsole, 'wf-1', 'exec-1', [
        makeLog({
          blockId: 'workflow-1',
          blockName: 'Workflow 1',
          blockType: 'workflow',
          executionOrder: 2,
          success: true,
          childTraceSpans: [
            {
              id: 'starter-span',
              name: 'Start',
              type: 'starter',
              blockId: 'starter',
              executionOrder: 3,
              status: 'success',
              duration: 5,
              startTime: startedAt,
              endTime: endedAt,
              output: {},
            },
            {
              id: 'api-span',
              name: 'API 1',
              type: 'api',
              blockId: 'api-1',
              executionOrder: 4,
              status: 'error',
              errorHandled: true,
              duration: 20,
              startTime: startedAt,
              endTime: endedAt,
              output: { error: 'Request failed' },
            },
          ],
        }),
      ])

      expect(updateConsole).toHaveBeenCalledTimes(2)
      expect(updateConsole.mock.calls[0]).toEqual([
        'starter',
        expect.objectContaining({
          success: true,
          isRunning: false,
          isCanceled: false,
          childWorkflowBlockId: 'workflow-1',
        }),
        'exec-1',
      ])
      expect(updateConsole.mock.calls[1]).toEqual([
        'api-1',
        expect.objectContaining({
          executionOrder: 4,
          success: false,
          error: 'Request failed',
          isRunning: false,
          isCanceled: false,
          childWorkflowBlockId: 'workflow-1',
        }),
        'exec-1',
      ])
    })

    it('uses span execution and iteration identity when reconciling repeated child blocks', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'workflow-1',
        blockName: 'Workflow 1',
        blockType: 'workflow',
        executionId: 'exec-1',
        executionOrder: 2,
        success: true,
        childWorkflowInstanceId: 'child-inst-1',
      })
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'api-1',
        blockName: 'API 1',
        blockType: 'api',
        executionId: 'exec-1',
        executionOrder: 3,
        isRunning: true,
        iterationCurrent: 0,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
        childWorkflowBlockId: 'workflow-1',
      })
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'api-1',
        blockName: 'API 1',
        blockType: 'api',
        executionId: 'exec-1',
        executionOrder: 4,
        isRunning: true,
        iterationCurrent: 1,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
        childWorkflowBlockId: 'workflow-1',
      })

      const startedAt = new Date().toISOString()
      const endedAt = new Date(Date.now() + 20).toISOString()
      const updateConsole = vi.fn()
      reconcileFinalBlockLogs(updateConsole, 'wf-1', 'exec-1', [
        makeLog({
          blockId: 'workflow-1',
          blockType: 'workflow',
          executionOrder: 2,
          childTraceSpans: [
            {
              id: 'api-iter-0',
              name: 'API 1',
              type: 'api',
              blockId: 'api-1',
              executionOrder: 3,
              loopId: 'loop-1',
              iterationIndex: 0,
              status: 'success',
              duration: 10,
              startTime: startedAt,
              endTime: endedAt,
              output: { result: 'first' },
            },
            {
              id: 'api-iter-1',
              name: 'API 1',
              type: 'api',
              blockId: 'api-1',
              executionOrder: 4,
              loopId: 'loop-1',
              iterationIndex: 1,
              status: 'error',
              duration: 20,
              startTime: startedAt,
              endTime: endedAt,
              output: { error: new Error('second failed') },
            },
          ],
        }),
      ])

      expect(updateConsole).toHaveBeenCalledTimes(2)
      expect(updateConsole.mock.calls[0]).toEqual([
        'api-1',
        expect.objectContaining({
          executionOrder: 3,
          iterationCurrent: 0,
          iterationType: 'loop',
          iterationContainerId: 'loop-1',
          replaceOutput: { result: 'first' },
          success: true,
        }),
        'exec-1',
      ])
      expect(updateConsole.mock.calls[1]).toEqual([
        'api-1',
        expect.objectContaining({
          executionOrder: 4,
          iterationCurrent: 1,
          iterationType: 'loop',
          iterationContainerId: 'loop-1',
          error: 'second failed',
          success: false,
        }),
        'exec-1',
      ])
    })

    it('recurses into nested workflow spans using the nested workflow instance id', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'workflow-1',
        blockName: 'Workflow 1',
        blockType: 'workflow',
        executionId: 'exec-1',
        executionOrder: 2,
        success: true,
        childWorkflowInstanceId: 'child-inst-1',
      })
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'nested-workflow',
        blockName: 'Nested Workflow',
        blockType: 'workflow',
        executionId: 'exec-1',
        executionOrder: 3,
        isRunning: false,
        childWorkflowBlockId: 'workflow-1',
        childWorkflowInstanceId: 'nested-inst-1',
      })
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'nested-api',
        blockName: 'Nested API',
        blockType: 'api',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
        childWorkflowBlockId: 'nested-workflow',
      })

      const startedAt = new Date().toISOString()
      const endedAt = new Date(Date.now() + 20).toISOString()
      const updateConsole = vi.fn()
      reconcileFinalBlockLogs(updateConsole, 'wf-1', 'exec-1', [
        makeLog({
          blockId: 'workflow-1',
          blockType: 'workflow',
          executionOrder: 2,
          childTraceSpans: [
            {
              id: 'nested-workflow-span',
              name: 'Nested Workflow',
              type: 'workflow',
              blockId: 'nested-workflow',
              executionOrder: 3,
              status: 'success',
              duration: 10,
              startTime: startedAt,
              endTime: endedAt,
              output: {},
              children: [
                {
                  id: 'nested-api-span',
                  name: 'Nested API',
                  type: 'api',
                  blockId: 'nested-api',
                  executionOrder: 1,
                  status: 'success',
                  duration: 10,
                  startTime: startedAt,
                  endTime: endedAt,
                  output: { ok: true },
                },
              ],
            },
          ],
        }),
      ])

      expect(updateConsole.mock.calls[1]).toEqual([
        'nested-api',
        expect.objectContaining({
          childWorkflowBlockId: 'nested-workflow',
          success: true,
          isRunning: false,
          isCanceled: false,
        }),
        'exec-1',
      ])
    })

    it('is a no-op when finalBlockLogs is empty or executionId is missing', () => {
      const updateConsole = vi.fn()
      reconcileFinalBlockLogs(updateConsole, 'wf-1', 'exec-1', [])
      reconcileFinalBlockLogs(updateConsole, 'wf-1', undefined, [makeLog({})])
      expect(updateConsole).not.toHaveBeenCalled()
    })
  })

  describe('handleExecutionErrorConsole', () => {
    it('cancels running entries before adding the synthetic entry', () => {
      const calls: string[] = []
      const addConsole = vi.fn(() => {
        calls.push('add')
        return undefined
      })
      const cancelRunningEntries = vi.fn(() => {
        calls.push('cancel')
      })

      handleExecutionErrorConsole(
        { addConsole, updateConsole: vi.fn(), cancelRunningEntries },
        {
          workflowId: 'wf-1',
          executionId: 'exec-1',
          error: 'boom',
          blockLogs: [],
        }
      )

      expect(calls[0]).toBe('cancel')
      expect(calls).toContain('add')
      expect(cancelRunningEntries).toHaveBeenCalledWith('wf-1', 'exec-1')
    })

    it('reconciles finalBlockLogs before sweeping running entries (Fix C)', () => {
      terminalConsoleMockFns.mockAddConsole({
        workflowId: 'wf-1',
        blockId: 'kb-1',
        blockName: 'Knowledge 1',
        blockType: 'knowledge',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
      })

      const calls: string[] = []
      const addConsole = vi.fn(() => {
        calls.push('add')
        return undefined
      })
      const cancelRunningEntries = vi.fn(() => {
        calls.push('cancel')
      })
      const updateConsole = vi.fn(() => {
        calls.push('update')
      })

      handleExecutionErrorConsole(
        { addConsole, updateConsole, cancelRunningEntries },
        {
          workflowId: 'wf-1',
          executionId: 'exec-1',
          error: 'boom',
          blockLogs: [],
          finalBlockLogs: [
            {
              blockId: 'kb-1',
              blockName: 'Knowledge 1',
              blockType: 'knowledge',
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 10,
              success: true,
              executionOrder: 1,
            } as any,
          ],
        }
      )

      expect(updateConsole).toHaveBeenCalledTimes(1)
      expect(calls).toEqual(['update', 'cancel', 'add'])
    })
  })
})
