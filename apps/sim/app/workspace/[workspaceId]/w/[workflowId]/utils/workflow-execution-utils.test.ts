/**
 * @vitest-environment node
 */
import { resetTerminalConsoleMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addExecutionErrorConsoleEntry,
  handleExecutionErrorConsole,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'

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

  describe('handleExecutionErrorConsole', () => {
    it('adds a synthetic Run Error entry when no block-level error covers it', () => {
      const addConsole = vi.fn()

      handleExecutionErrorConsole(
        { addConsole, updateConsole: vi.fn() },
        {
          workflowId: 'wf-1',
          executionId: 'exec-1',
          error: 'boom',
          blockLogs: [],
        }
      )

      expect(addConsole).toHaveBeenCalledTimes(1)
      expect(addConsole.mock.calls[0][0].blockName).toBe('Run Error')
    })

    it('skips the synthetic entry when a block-level error already covers the failure', () => {
      const addConsole = vi.fn()

      handleExecutionErrorConsole(
        { addConsole, updateConsole: vi.fn() },
        {
          workflowId: 'wf-1',
          executionId: 'exec-1',
          error: 'boom',
          blockLogs: [
            {
              blockId: 'fn-1',
              blockName: 'Function',
              blockType: 'function',
              success: false,
              error: 'JSON parse failed',
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 10,
              executionOrder: 1,
            } as any,
          ],
        }
      )

      expect(addConsole).not.toHaveBeenCalled()
    })
  })
})
