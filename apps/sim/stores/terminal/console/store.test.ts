/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalConsoleStore } from '@/stores/terminal/console/store'

describe('terminal console store', () => {
  beforeEach(() => {
    useTerminalConsoleStore.setState({
      entries: [],
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

    const [entry] = useTerminalConsoleStore.getState().entries

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

    const [entry] = useTerminalConsoleStore.getState().entries

    expect(entry.output).toMatchObject({
      __simTruncated: true,
    })
  })
})
