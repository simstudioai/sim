import type { TerminalTabState } from '@sim/terminal-protocol'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

function tab(overrides: Partial<TerminalTabState> = {}): TerminalTabState {
  return {
    terminalId: 't1',
    title: 'code',
    cwd: '/Users/me/code',
    running: null,
    interactive: false,
    active: true,
    ...overrides,
  }
}

describe('copilot terminal store', () => {
  beforeEach(() => {
    useCopilotTerminalStore.setState({
      tabs: { tabs: [], activeTerminalId: null },
      agentCommandIds: [],
    })
  })

  /**
   * The desktop app re-pushes the whole tab list on a timer, so an identical
   * push has to keep its identity or the panel and every terminal in it
   * re-render once a second for nothing.
   */
  it('keeps state identity when a push says nothing new', () => {
    const { setTabs } = useCopilotTerminalStore.getState()
    setTabs({ tabs: [tab()], activeTerminalId: 't1' })
    const first = useCopilotTerminalStore.getState().tabs

    setTabs({ tabs: [tab()], activeTerminalId: 't1' })

    expect(useCopilotTerminalStore.getState().tabs).toBe(first)
  })

  it.each([
    ['a command starts', { running: 'bun test' }],
    ['the directory changes', { cwd: '/tmp' }],
    ['the title changes', { title: 'tmp' }],
    ['a full-screen program takes over', { interactive: true }],
    ['the tab stops being active', { active: false }],
    ['tmux attaches', { tmuxSession: 'main' }],
  ])('takes the update when %s', (_case, change) => {
    const { setTabs } = useCopilotTerminalStore.getState()
    setTabs({ tabs: [tab()], activeTerminalId: 't1' })
    const first = useCopilotTerminalStore.getState().tabs

    setTabs({ tabs: [tab(change)], activeTerminalId: 't1' })

    expect(useCopilotTerminalStore.getState().tabs).not.toBe(first)
    expect(useCopilotTerminalStore.getState().tabs.tabs[0]).toMatchObject(change)
  })

  it('takes the update when the active terminal changes', () => {
    const { setTabs } = useCopilotTerminalStore.getState()
    const tabs = [tab(), tab({ terminalId: 't2', active: false })]
    setTabs({ tabs, activeTerminalId: 't1' })
    const first = useCopilotTerminalStore.getState().tabs

    setTabs({ tabs, activeTerminalId: 't2' })

    expect(useCopilotTerminalStore.getState().tabs).not.toBe(first)
  })

  it('takes the update when a tab opens or closes', () => {
    const { setTabs } = useCopilotTerminalStore.getState()
    setTabs({ tabs: [tab()], activeTerminalId: 't1' })
    const first = useCopilotTerminalStore.getState().tabs

    setTabs({ tabs: [tab(), tab({ terminalId: 't2' })], activeTerminalId: 't1' })

    expect(useCopilotTerminalStore.getState().tabs).not.toBe(first)
    expect(useCopilotTerminalStore.getState().tabs.tabs).toHaveLength(2)
  })

  /**
   * The comparator walks keys rather than a written-out field list precisely so
   * that a field added to the protocol cannot quietly stop reaching the UI.
   */
  it('takes the update when a tab carries a field the comparator never named', () => {
    const { setTabs } = useCopilotTerminalStore.getState()
    setTabs({ tabs: [tab()], activeTerminalId: 't1' })
    const first = useCopilotTerminalStore.getState().tabs

    setTabs({
      tabs: [{ ...tab(), somethingNew: true } as TerminalTabState],
      activeTerminalId: 't1',
    })

    expect(useCopilotTerminalStore.getState().tabs).not.toBe(first)
  })
})
