/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import type { TerminalTabState } from '@sim/terminal-protocol'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { useTerminalTabResources } from '@/app/workspace/[workspaceId]/home/hooks/use-terminal-tab-resources'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

const { switchTerminal } = vi.hoisted(() => ({
  switchTerminal: vi.fn(async () => {}),
}))

vi.mock('@/lib/terminal/transport', () => ({ switchTerminal }))

const SCOPE = 'chat-1'

function shell(
  terminalId: string,
  active = false,
  running: string | null = null
): TerminalTabState {
  return {
    terminalId,
    title: `dir-${terminalId}`,
    cwd: `/code/${terminalId}`,
    running,
    interactive: false,
    active,
  }
}

function pushTabs(scopeId: string, tabs: TerminalTabState[], activeTerminalId: string | null) {
  act(() => {
    useCopilotTerminalStore.getState().setTabs({ scopeId, tabs, activeTerminalId })
  })
}

interface HostProps {
  scopeId: string
  resources: MothershipResource[]
  activeResourceId: string | null
  selectedResourceId: string | null
  addResource: (resource: MothershipResource) => void
  removeResource: (type: MothershipResource['type'], id: string) => void
  selectResource: (id: string) => void
  restoreResource: (id: string) => void
  onResourceEvent: (id: string, options?: { activate?: boolean }) => void
}

function Host(props: HostProps) {
  useTerminalTabResources(props)
  return null
}

describe('useTerminalTabResources', () => {
  let root: Root
  let container: HTMLDivElement
  const addResource = vi.fn()
  const removeResource = vi.fn()
  const selectResource = vi.fn()
  const restoreResource = vi.fn()
  const onResourceEvent = vi.fn()

  function render(overrides: Partial<HostProps> = {}) {
    const props: HostProps = {
      scopeId: SCOPE,
      resources: [],
      activeResourceId: null,
      selectedResourceId: null,
      addResource,
      removeResource,
      selectResource,
      restoreResource,
      onResourceEvent,
      ...overrides,
    }
    act(() => root.render(<Host {...props} />))
    return (next: Partial<HostProps>) => act(() => root.render(<Host {...props} {...next} />))
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.clearAllMocks()
    useCopilotTerminalStore.setState({
      activeScopeId: SCOPE,
      sessions: {},
      settledAgentCommandIds: [],
    })
    act(() => useCopilotTerminalStore.getState().activateScope(SCOPE))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('projects each live shell into a terminal resource and removes closed shells', () => {
    const rerender = render()
    pushTabs(SCOPE, [shell('1', true), shell('2')], '1')

    expect(addResource.mock.calls.map(([resource]) => resource)).toEqual([
      { type: 'terminal', id: 'terminal:1', title: 'dir-1' },
      { type: 'terminal', id: 'terminal:2', title: 'dir-2' },
    ])

    rerender({
      resources: [
        { type: 'terminal', id: 'terminal:1', title: 'dir-1' },
        { type: 'terminal', id: 'terminal:2', title: 'dir-2' },
      ],
    })
    pushTabs(SCOPE, [shell('1', true)], '1')
    expect(removeResource).toHaveBeenCalledExactlyOnceWith('terminal', 'terminal:2')
  })

  it('shows the selected shell without claiming it, and ignores the switch landing', () => {
    const resources: MothershipResource[] = [
      { type: 'terminal', id: 'terminal:1', title: 'dir-1' },
      { type: 'terminal', id: 'terminal:2', title: 'dir-2' },
    ]
    const rerender = render({
      resources,
      activeResourceId: 'terminal:1',
      selectedResourceId: 'terminal:1',
    })
    pushTabs(SCOPE, [shell('1', true), shell('2')], '1')
    expect(switchTerminal).not.toHaveBeenCalled()

    rerender({ activeResourceId: 'terminal:2', selectedResourceId: 'terminal:2' })
    expect(switchTerminal).toHaveBeenCalledExactlyOnceWith('2', SCOPE, { claim: false })

    pushTabs(SCOPE, [shell('1'), shell('2', true)], '2')
    expect(selectResource).not.toHaveBeenCalled()
  })

  it('adopts the native active shell on reopen instead of pushing the fallback tab', () => {
    const rerender = render()
    pushTabs(SCOPE, [shell('1', true), shell('2')], '1')
    rerender({
      resources: [
        { type: 'terminal', id: 'terminal:1', title: 'dir-1' },
        { type: 'terminal', id: 'terminal:2', title: 'dir-2' },
      ],
      activeResourceId: 'terminal:2',
      selectedResourceId: null,
    })

    expect(switchTerminal).not.toHaveBeenCalled()
    expect(restoreResource).toHaveBeenCalledExactlyOnceWith('terminal:1')
    expect(selectResource).not.toHaveBeenCalled()
  })

  it('follows a native switch into the strip only while the user is on a terminal', () => {
    const resources: MothershipResource[] = [
      { type: 'terminal', id: 'terminal:1', title: 'dir-1' },
      { type: 'terminal', id: 'terminal:2', title: 'dir-2' },
      { type: 'file', id: 'f', title: 'notes.md' },
    ]
    const rerender = render({
      resources,
      activeResourceId: 'terminal:1',
      selectedResourceId: 'terminal:1',
    })
    pushTabs(SCOPE, [shell('1', true), shell('2')], '1')

    pushTabs(SCOPE, [shell('1'), shell('2', true)], '2')
    expect(selectResource).toHaveBeenCalledExactlyOnceWith('terminal:2')

    selectResource.mockClear()
    rerender({ activeResourceId: 'f', selectedResourceId: 'f' })
    pushTabs(SCOPE, [shell('1', true), shell('2')], '1')
    expect(selectResource).not.toHaveBeenCalled()
  })

  it('announces the shell running an agent command as activity', () => {
    render({
      resources: [
        { type: 'terminal', id: 'terminal:1', title: 'dir-1' },
        { type: 'terminal', id: 'terminal:2', title: 'dir-2' },
      ],
      activeResourceId: 'terminal:1',
      selectedResourceId: 'terminal:1',
    })
    pushTabs(SCOPE, [shell('1', true), shell('2')], '1')
    act(() => {
      useCopilotTerminalStore.getState().applyCommandEvent({
        scopeId: SCOPE,
        terminalId: '2',
        phase: 'start',
        command: 'bun test',
        toolCallId: 'tool-1',
      })
    })

    expect(onResourceEvent).toHaveBeenCalledExactlyOnceWith('terminal:2', { activate: true })
    expect(switchTerminal).not.toHaveBeenCalled()
  })
})
