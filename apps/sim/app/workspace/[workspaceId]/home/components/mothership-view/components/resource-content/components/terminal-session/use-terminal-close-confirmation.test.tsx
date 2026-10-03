/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalCloseConfirmation } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/use-terminal-close-confirmation'

const cleanups: (() => void)[] = []

function renderHook(useHook: () => ReturnType<typeof useTerminalCloseConfirmation>) {
  let value: ReturnType<typeof useTerminalCloseConfirmation> | undefined
  function Harness() {
    value = useHook()
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    act(() => root.unmount())
  }
  cleanups.push(unmount)
  act(() => root.render(<Harness />))
  return {
    result: {
      get current() {
        if (!value) throw new Error('Hook was not rendered')
        return value
      },
    },
    rerender: () => act(() => root.render(<Harness />)),
    unmount,
  }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const { getState } = vi.hoisted(() => ({ getState: vi.fn() }))
vi.mock('@/stores/copilot-terminal/store', () => ({ useCopilotTerminalStore: { getState } }))
vi.mock('@sim/emcn', () => ({ ChipConfirmModal: vi.fn(), toast: { warning: vi.fn() } }))

function setRunning(running: string | null) {
  getState.mockReturnValue({
    sessions: { scope: { tabs: { tabs: [{ terminalId: 'terminal', running }] } } },
  })
}

beforeEach(() => {
  setRunning('sleep 1')
})

describe('useTerminalCloseConfirmation', () => {
  it('refuses to close when the running command changed while the dialog was open', async () => {
    const { result } = renderHook(() => useTerminalCloseConfirmation('scope'))
    let decision: Promise<boolean> | undefined
    act(() => {
      decision = result.current.confirmTerminalClose(['terminal'])
    })
    setRunning('build')
    act(() => {
      result.current.confirmationDialog?.props.confirm.onClick()
    })
    await expect(decision).resolves.toBe(false)
  })

  it('does not resurrect a cancelled dialog when returning to its scope', async () => {
    let scopeId = 'scope'
    const { result, rerender } = renderHook(() => useTerminalCloseConfirmation(scopeId))
    let decision: Promise<boolean> | undefined
    act(() => {
      decision = result.current.confirmTerminalClose(['terminal'])
    })
    scopeId = 'another-scope'
    rerender()
    await expect(decision).resolves.toBe(false)
    expect(result.current.confirmationDialog).toBeNull()
    scopeId = 'scope'
    rerender()
    expect(result.current.confirmationDialog).toBeNull()
    act(() => {
      decision = result.current.confirmTerminalClose(['terminal'])
    })
    act(() => {
      result.current.confirmationDialog?.props.confirm.onClick()
    })
    await expect(decision).resolves.toBe(true)
  })
})
