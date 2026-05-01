/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/stores/terminal')
vi.unmock('@/stores/terminal/console/store')

import { useTerminalConsoleStore } from '@/stores/terminal/console/store'

const storeLoggerCallIdx = vi
  .mocked(createLogger)
  .mock.calls.findIndex((call) => call[0] === 'TerminalConsoleStore')
const storeLogger =
  storeLoggerCallIdx >= 0
    ? vi.mocked(createLogger).mock.results[storeLoggerCallIdx]?.value
    : undefined

describe('terminal console store', () => {
  beforeEach(() => {
    useTerminalConsoleStore.setState({
      workflowEntries: {},
      entryIdsByBlockExecution: {},
      entryIdByBlockExecutionId: {},
      entryLocationById: {},
      isOpen: false,
      _hasHydrated: true,
    })
    storeLogger?.warn.mockClear()
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

  describe('blockExecutionId keying', () => {
    it('updates an entry via the primary index without firing legacy warn', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        blockExecutionId: 'bex-1',
        executionOrder: 1,
        isRunning: true,
      })

      useTerminalConsoleStore.getState().updateConsole(
        'block-1',
        {
          executionOrder: 1,
          blockExecutionId: 'bex-1',
          success: true,
          replaceOutput: { status: 'done' },
        },
        'exec-1'
      )

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.success).toBe(true)
      expect(entry.output).toMatchObject({ status: 'done' })
      expect(storeLogger?.warn).not.toHaveBeenCalled()
    })

    it('falls back to legacy keying and warns when blockExecutionId is unknown', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
      })

      useTerminalConsoleStore.getState().updateConsole(
        'block-1',
        {
          executionOrder: 1,
          blockExecutionId: 'bex-unknown',
          success: true,
          replaceOutput: { status: 'done' },
        },
        'exec-1'
      )

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.success).toBe(true)
      expect(storeLogger?.warn).toHaveBeenCalledWith(
        'updateConsole used legacy keying (hydrated or cross-deploy entry)',
        expect.objectContaining({ blockExecutionId: 'bex-unknown', blockId: 'block-1' })
      )
    })

    it('uses legacy keying without warning when no blockExecutionId is provided', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        executionOrder: 1,
        isRunning: true,
      })

      useTerminalConsoleStore
        .getState()
        .updateConsole(
          'block-1',
          { executionOrder: 1, success: true, replaceOutput: { status: 'done' } },
          'exec-1'
        )

      const [entry] = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entry.success).toBe(true)
      expect(storeLogger?.warn).not.toHaveBeenCalled()
    })
  })

  describe('addConsole idempotency', () => {
    it('returns the existing entry when called twice with the same blockExecutionId', () => {
      const first = useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        blockExecutionId: 'bex-1',
        executionOrder: 1,
        isRunning: true,
      })

      const second = useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        blockExecutionId: 'bex-1',
        executionOrder: 1,
        isRunning: true,
      })

      const entries = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entries).toHaveLength(1)
      expect(second?.id).toBe(first?.id)
    })

    it('creates distinct entries for different blockExecutionIds (loop iterations)', () => {
      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        blockExecutionId: 'bex-iter-1',
        executionOrder: 1,
        isRunning: true,
      })

      useTerminalConsoleStore.getState().addConsole({
        workflowId: 'wf-1',
        blockId: 'block-1',
        blockName: 'Function',
        blockType: 'function',
        executionId: 'exec-1',
        blockExecutionId: 'bex-iter-2',
        executionOrder: 2,
        isRunning: true,
      })

      const entries = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
      expect(entries).toHaveLength(2)
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
  })
})
