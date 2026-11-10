import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSaveBlob } = vi.hoisted(() => ({
  mockSaveBlob: vi.fn(),
}))

vi.mock('@/lib/uploads/client/download', () => ({
  saveBlob: mockSaveBlob,
}))

vi.unmock('@/stores/terminal')
vi.unmock('@/stores/terminal/console/store')

import { connectToastSink } from '@/lib/toast/sink'
import { useTerminalConsoleStore } from '@/stores/terminal/console/store'

describe('terminal console store', () => {
  beforeEach(() => {
    mockSaveBlob.mockClear()
    useTerminalConsoleStore.setState({
      workflowEntries: {},
      entryIdsByBlockExecution: {},
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

  describe('cancelRunningEntries', () => {
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

  describe("a block error's Fix in Chat", () => {
    function failBlock(executionId: string) {
      const shown: Array<{ message: string; action?: { label: string; onClick: () => void } }> = []
      const disconnect = connectToastSink({
        show: (toast) => {
          shown.push(toast)
          return 'toast'
        },
        dismiss: () => {},
      })
      try {
        useTerminalConsoleStore.getState().addConsole({
          workflowId: 'wf-1',
          blockId: 'block-1',
          blockName: 'Agent',
          blockType: 'agent',
          executionId,
          executionOrder: 1,
          error: 'Model refused',
        })
      } finally {
        disconnect()
      }
      return shown
    }

    it('hands the error to a new chat through the mounted editor', () => {
      const handOff = vi.fn()
      useTerminalConsoleStore.getState().setChatHandoff(handOff)

      const [toast] = failBlock('exec-fix-1')
      expect(toast.action?.label).toBe('Fix in Chat')
      toast.action?.onClick()

      expect(handOff).toHaveBeenCalledWith('Model refused\n\nError in Agent.\n\nPlease fix this.')
    })

    it('offers no Fix in Chat where the viewer cannot start a chat', () => {
      useTerminalConsoleStore.getState().setChatHandoff(null)

      const [toast] = failBlock('exec-fix-2')

      expect(toast.message).toBe('Agent')
      expect(toast.action).toBeUndefined()
    })
  })
})
