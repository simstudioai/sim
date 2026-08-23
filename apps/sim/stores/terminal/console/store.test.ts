/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSaveBlob } = vi.hoisted(() => ({
  mockSaveBlob: vi.fn(),
}))

vi.mock('@/lib/uploads/client/download', () => ({
  saveBlob: mockSaveBlob,
}))

vi.unmock('@/stores/terminal')
vi.unmock('@/stores/terminal/console/store')

import { useTerminalConsoleStore } from '@/stores/terminal/console/store'

const storeLoggerCallIndex = vi
  .mocked(createLogger)
  .mock.calls.findIndex(([name]) => name === 'TerminalConsoleStore')
const storeLogger = vi.mocked(createLogger).mock.results[storeLoggerCallIndex]?.value

describe('terminal console store', () => {
  beforeEach(() => {
    mockSaveBlob.mockClear()
    storeLogger?.warn.mockClear()
    useTerminalConsoleStore.setState({
      workflowEntries: {},
      entryIdsByBlockExecution: {},
      entryIdByBlockExecutionId: {},
      entryLocationById: {},
      isOpen: false,
      _hasHydrated: true,
    })
  })

  it('neutralizes formula-leading text in CSV exports', async () => {
    useTerminalConsoleStore.getState().addConsole({
      workflowId: 'wf-1',
      blockId: 'block-1',
      blockName: 'Function',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 1,
      error: '=1+1',
    })

    useTerminalConsoleStore.getState().exportConsoleCSV('wf-1')

    expect(mockSaveBlob).toHaveBeenCalledOnce()
    const [blob, filename] = mockSaveBlob.mock.calls[0] as [Blob, string]
    expect(filename).toMatch(/^terminal-console-wf-1-.*\.csv$/)
    await expect(blob.text()).resolves.toContain(",'=1+1,")
  })

  it('normalizes oversized payloads when adding console entries', () => {
    useTerminalConsoleStore.getState().addConsole({
      workflowId: 'wf-1',
      blockId: 'block-1',
      blockName: 'Function',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 1,
      output: {
        a: 'x'.repeat(100_000),
        b: 'y'.repeat(100_000),
        c: 'z'.repeat(100_000),
        d: 'q'.repeat(100_000),
        e: 'r'.repeat(100_000),
        f: 's'.repeat(100_000),
      },
    })

    const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')

    expect(entry.output).toMatchObject({
      __simTruncated: true,
    })
  })

  it('normalizes oversized replaceOutput updates', () => {
    useTerminalConsoleStore.getState().addConsole({
      workflowId: 'wf-1',
      blockId: 'block-1',
      blockName: 'Function',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 1,
      output: { ok: true },
    })

    useTerminalConsoleStore.getState().updateConsole(
      'block-1',
      {
        executionOrder: 1,
        replaceOutput: {
          a: 'x'.repeat(100_000),
          b: 'y'.repeat(100_000),
          c: 'z'.repeat(100_000),
          d: 'q'.repeat(100_000),
          e: 'r'.repeat(100_000),
          f: 's'.repeat(100_000),
        },
      },
      'exec-1'
    )

    const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')

    expect(entry.output).toMatchObject({
      __simTruncated: true,
    })
  })

  it('updates one workflow without replacing unrelated workflow arrays', () => {
    useTerminalConsoleStore.getState().addConsole({
      workflowId: 'wf-1',
      blockId: 'block-1',
      blockName: 'Function',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 1,
      output: { ok: true },
    })

    useTerminalConsoleStore.getState().addConsole({
      workflowId: 'wf-2',
      blockId: 'block-2',
      blockName: 'Function',
      blockType: 'function',
      executionId: 'exec-2',
      executionOrder: 1,
      output: { ok: true },
    })

    const before = useTerminalConsoleStore.getState()
    const workflowTwoEntries = before.workflowEntries['wf-2']

    useTerminalConsoleStore.getState().updateConsole(
      'block-1',
      {
        executionOrder: 1,
        replaceOutput: { status: 'updated' },
      },
      'exec-1'
    )

    const after = useTerminalConsoleStore.getState()

    expect(after.workflowEntries['wf-2']).toBe(workflowTwoEntries)
    expect(after.getWorkflowEntries('wf-1')[0].output).toMatchObject({ status: 'updated' })
  })

  describe('per-invocation attribution', () => {
    it('isolates colliding iteration updates by blockExecutionId', () => {
      const addConsole = useTerminalConsoleStore.getState().addConsole
      for (const blockExecutionId of ['invoke-0', 'invoke-1']) {
        addConsole({
          workflowId: 'wf-1',
          blockId: 'function-1',
          blockExecutionId,
          blockName: 'Function',
          blockType: 'function',
          executionId: 'exec-1',
          executionOrder: 7,
          iterationCurrent: 0,
          iterationType: 'loop',
          iterationContainerId: 'loop-1',
          isRunning: true,
        })
      }

      useTerminalConsoleStore.getState().updateConsole(
        'function-1',
        {
          blockExecutionId: 'invoke-0',
          blockName: 'Function success',
          replaceOutput: { iteration: 0 },
          success: true,
          startedAt: '2026-08-22T10:00:00.000Z',
          endedAt: '2026-08-22T10:00:00.010Z',
          durationMs: 10,
          isRunning: false,
        },
        'exec-1'
      )
      useTerminalConsoleStore.getState().updateConsole(
        'function-1',
        {
          blockExecutionId: 'invoke-1',
          blockName: 'Function failure',
          replaceOutput: {},
          error: 'iteration-1-failure',
          success: false,
          startedAt: '2026-08-22T10:00:01.000Z',
          endedAt: '2026-08-22T10:00:01.020Z',
          durationMs: 20,
          isRunning: false,
        },
        'exec-1'
      )

      const entries = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entries.find((entry) => entry.blockExecutionId === 'invoke-0')).toMatchObject({
        blockName: 'Function success',
        output: { iteration: 0 },
        success: true,
        error: undefined,
        durationMs: 10,
        startedAt: '2026-08-22T10:00:00.000Z',
        endedAt: '2026-08-22T10:00:00.010Z',
        isRunning: false,
      })
      expect(entries.find((entry) => entry.blockExecutionId === 'invoke-1')).toMatchObject({
        blockName: 'Function failure',
        output: {},
        success: false,
        error: 'iteration-1-failure',
        durationMs: 20,
        startedAt: '2026-08-22T10:00:01.000Z',
        endedAt: '2026-08-22T10:00:01.020Z',
        isRunning: false,
      })
    })

    it('treats a replayed start as idempotent', () => {
      const start = {
        workflowId: 'wf-1',
        blockId: 'function-1',
        blockExecutionId: 'invoke-0',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
      }

      const first = useTerminalConsoleStore.getState().addConsole(start)
      const replay = useTerminalConsoleStore.getState().addConsole(start)

      expect(replay?.id).toBe(first?.id)
      expect(useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')).toHaveLength(1)
    })

    it('warns and leaves ambiguous legacy entries unchanged', () => {
      const addConsole = useTerminalConsoleStore.getState().addConsole
      for (const blockName of ['First', 'Second']) {
        addConsole({
          workflowId: 'wf-1',
          blockId: 'function-1',
          blockName,
          blockType: 'function',
          executionId: 'exec-1',
          executionOrder: 1,
          iterationCurrent: 0,
          iterationType: 'loop',
          iterationContainerId: 'loop-1',
          isRunning: true,
        })
      }

      useTerminalConsoleStore.getState().updateConsole(
        'function-1',
        {
          executionOrder: 1,
          iterationCurrent: 0,
          iterationType: 'loop',
          iterationContainerId: 'loop-1',
          replaceOutput: { overwritten: true },
          success: true,
        },
        'exec-1'
      )

      expect(
        useTerminalConsoleStore
          .getState()
          .getWorkflowEntries('wf-1')
          .every((entry) => entry.output === undefined && entry.success === undefined)
      ).toBe(true)
      expect(storeLogger?.warn).toHaveBeenCalledWith(
        'Ignoring ambiguous legacy terminal update',
        expect.objectContaining({ blockId: 'function-1', candidateCount: 2 })
      )
    })

    it('enriches an exactly matched legacy child workflow entry with its instance id', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'workflow-1',
        blockName: 'Workflow',
        blockType: 'workflow',
        executionId: 'exec-1',
        executionOrder: 3,
        iterationCurrent: 1,
        iterationType: 'loop',
        iterationContainerId: 'loop-1',
        isRunning: true,
      })

      useTerminalConsoleStore.getState().updateConsole(
        'workflow-1',
        {
          childWorkflowInstanceId: 'child-inst-1',
          executionOrder: 3,
          iterationCurrent: 1,
          iterationType: 'loop',
          iterationContainerId: 'loop-1',
        },
        'exec-1'
      )

      expect(useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')[0]).toMatchObject({
        childWorkflowInstanceId: 'child-inst-1',
        isRunning: true,
      })
    })
  })

  describe('cancelRunningEntries', () => {
    it('flips a plain running entry to canceled', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
        startedAt: new Date(Date.now() - 1000).toISOString(),
      })

      useTerminalConsoleStore.getState().cancelRunningEntries('wf-1')

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.isCanceled).toBe(true)
      expect(entry.isRunning).toBe(false)
    })

    it('settles live agent stream chrome when canceling', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Agent',
        blockType: 'agent',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
        agentStreamActive: true,
        agentStreamThinking: 'drafting…',
        agentStreamToolCalls: [
          {
            key: 'block-1:t1',
            id: 't1',
            name: 'http_request',
            displayName: 'HTTP Request',
            status: 'running',
          },
        ],
      })

      useTerminalConsoleStore.getState().cancelRunningEntries('wf-1', 'exec-1')

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.agentStreamActive).toBe(false)
      expect(entry.agentStreamThinking).toBe('drafting…')
      expect(entry.agentStreamToolCalls?.[0]?.status).toBe('cancelled')
    })

    it('only cancels running entries for the requested execution when provided', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function 1',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
      })
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-2',
        blockName: 'Function 2',
        blockType: 'function',
        executionId: 'exec-2',
        executionOrder: 2,
        isRunning: true,
      })

      useTerminalConsoleStore.getState().cancelRunningEntries('wf-1', 'exec-1')

      const entries = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entries.find((entry) => entry.executionId === 'exec-1')).toMatchObject({
        isCanceled: true,
        isRunning: false,
      })
      expect(entries.find((entry) => entry.executionId === 'exec-2')).toMatchObject({
        isRunning: true,
      })
    })
  })

  describe('finishRunningEntries', () => {
    it('settles running entries without marking them canceled', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
        startedAt: new Date(Date.now() - 1000).toISOString(),
      })

      useTerminalConsoleStore.getState().finishRunningEntries('wf-1', 'exec-1')

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.isCanceled).toBe(false)
      expect(entry.isRunning).toBe(false)
      expect(entry.endedAt).toBeDefined()
    })

    it('settles live agent stream chrome when finishing', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Agent',
        blockType: 'agent',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
        agentStreamActive: true,
        agentStreamToolCalls: [
          {
            key: 'block-1:t1',
            id: 't1',
            name: 'http_request',
            displayName: 'HTTP Request',
            status: 'running',
          },
        ],
      })

      useTerminalConsoleStore.getState().finishRunningEntries('wf-1', 'exec-1')

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.agentStreamActive).toBe(false)
      expect(entry.agentStreamToolCalls?.[0]?.status).toBe('success')
    })
  })

  describe('updateConsole agent stream chrome', () => {
    it('settles running tools and clears agentStreamActive when a block errors', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Agent',
        blockType: 'agent',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
        agentStreamActive: true,
        agentStreamThinking: 'working…',
        agentStreamToolCalls: [
          {
            key: 'block-1:t1',
            id: 't1',
            name: 'http_request',
            displayName: 'HTTP Request',
            status: 'running',
          },
        ],
      })

      useTerminalConsoleStore.getState().updateConsole(
        'block-1',
        {
          isRunning: false,
          success: false,
          error: 'timeout',
        },
        'exec-1'
      )

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.agentStreamActive).toBe(false)
      expect(entry.agentStreamThinking).toBe('working…')
      expect(entry.agentStreamToolCalls?.[0]?.status).toBe('error')
    })

    it('clears thinking without changing an active block when projection is unavailable', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Agent',
        blockType: 'agent',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
        agentStreamActive: true,
        agentStreamThinking: 'projected thinking',
      })

      useTerminalConsoleStore
        .getState()
        .updateConsole('block-1', { clearAgentStreamThinking: true }, 'exec-1')

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.isRunning).toBe(true)
      expect(entry.agentStreamActive).toBe(true)
      expect(entry.agentStreamThinking).toBeUndefined()
    })
  })
})
