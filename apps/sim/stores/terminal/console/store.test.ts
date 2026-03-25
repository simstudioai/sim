/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalConsoleStore } from '@/stores/terminal/console/store'

describe('terminal console store', () => {
  beforeEach(() => {
    useTerminalConsoleStore.setState({
      workflowEntries: {},
      entryIdsByBlockExecution: {},
      entryLocationById: {},
      isOpen: false,
      _hasHydrated: true,
    })
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
})
