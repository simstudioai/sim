/**
 * @vitest-environment node
 */
import { resetTerminalConsoleMock, terminalConsoleMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addExecutionErrorConsoleEntry,
  handleExecutionErrorConsole,
  reconcileFinalBlockLogs,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import type { BlockLog } from '@/executor/types'

describe('workflow-execution-utils', () => {
  beforeEach(() => {
    resetTerminalConsoleMock()
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
