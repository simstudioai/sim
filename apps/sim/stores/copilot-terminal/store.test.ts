import type { TerminalTabState } from '@sim/terminal-protocol'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCopilotTerminalSession,
  LEGACY_TERMINAL_SCOPE,
  useCopilotTerminalStore,
} from '@/stores/copilot-terminal/store'

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
    const session = {
      tabs: { tabs: [], activeTerminalId: null },
      agentCommandIds: [],
      suspended: false,
    }
    useCopilotTerminalStore.setState({
      ...session,
      activeScopeId: LEGACY_TERMINAL_SCOPE,
      sessions: { [LEGACY_TERMINAL_SCOPE]: session },
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

  it('isolates overlapping terminal ids and late command events by chat', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.setTabs(
      { scopeId: 'chat-a', tabs: [tab({ title: 'A' })], activeTerminalId: 't1' },
      'chat-a'
    )
    store.activateScope('chat-b')
    store.setTabs(
      { scopeId: 'chat-b', tabs: [tab({ title: 'B' })], activeTerminalId: 't1' },
      'chat-b'
    )

    store.applyCommandEvent(
      {
        scopeId: 'chat-a',
        terminalId: 't1',
        phase: 'start',
        command: 'bun test',
        toolCallId: 'tool-a',
      },
      'chat-a'
    )

    expect(useCopilotTerminalStore.getState().tabs.tabs[0].title).toBe('B')
    expect(useCopilotTerminalStore.getState().agentCommandIds).toEqual([])
    expect(getCopilotTerminalSession('chat-a').agentCommandIds).toEqual(['tool-a'])

    store.activateScope('chat-a')
    expect(useCopilotTerminalStore.getState().tabs.tabs[0].title).toBe('A')
    expect(useCopilotTerminalStore.getState().agentCommandIds).toEqual(['tool-a'])
  })

  it('moves pending terminals onto the resolved chat id', () => {
    const store = useCopilotTerminalStore.getState()
    store.setTabs(
      {
        scopeId: 'pending:workspace-1',
        tabs: [tab({ title: 'Pending' })],
        activeTerminalId: 't1',
      },
      'pending:workspace-1'
    )
    store.activateScope('pending:workspace-1')

    store.migrateScope('pending:workspace-1', 'chat-1')

    expect(useCopilotTerminalStore.getState().activeScopeId).toBe('chat-1')
    expect(useCopilotTerminalStore.getState().sessions['pending:workspace-1']).toBeUndefined()
    expect(getCopilotTerminalSession('chat-1').tabs.tabs[0].title).toBe('Pending')
  })

  it('replaces a pristine durable bucket created before pending migration finishes', () => {
    const store = useCopilotTerminalStore.getState()
    store.setTabs(
      {
        scopeId: 'pending:new',
        tabs: [tab({ title: 'Pending' })],
        activeTerminalId: 't1',
      },
      'pending:new'
    )

    store.activateScope('chat-1')
    store.setTabs({ scopeId: 'chat-1', tabs: [], activeTerminalId: null }, 'chat-1')
    store.migrateScope('pending:new', 'chat-1')

    expect(useCopilotTerminalStore.getState().sessions['pending:new']).toBeUndefined()
    expect(useCopilotTerminalStore.getState().activeScopeId).toBe('chat-1')
    expect(getCopilotTerminalSession('chat-1').tabs.tabs[0].title).toBe('Pending')
  })

  it('removes an abandoned pending group without touching another chat', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.setTabs({ tabs: [tab({ title: 'A' })], activeTerminalId: 't1' }, 'chat-a')
    store.activateScope('pending:new')

    store.discardScope('pending:new')

    expect(useCopilotTerminalStore.getState().sessions['pending:new']).toBeUndefined()
    expect(getCopilotTerminalSession('chat-a').tabs.tabs[0].title).toBe('A')
    expect(useCopilotTerminalStore.getState().activeScopeId).toBe(LEGACY_TERMINAL_SCOPE)
  })

  it('clears live terminal ids while suspended and ignores late native events', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.setTabs({ scopeId: 'chat-a', tabs: [tab()], activeTerminalId: 't1' }, 'chat-a')
    store.applyCommandEvent(
      {
        scopeId: 'chat-a',
        terminalId: 't1',
        phase: 'start',
        command: 'bun test',
        toolCallId: 'tool-a',
      },
      'chat-a'
    )

    store.suspendScope('chat-a')
    store.setTabs(
      { scopeId: 'chat-a', tabs: [tab({ terminalId: 'stale' })], activeTerminalId: 'stale' },
      'chat-a'
    )

    expect(getCopilotTerminalSession('chat-a')).toEqual({
      tabs: { tabs: [], activeTerminalId: null },
      agentCommandIds: [],
      suspended: true,
    })
  })

  it('clears suspension on explicit activation, including the already-active scope', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.suspendScope('chat-a')

    store.activateScope('chat-a')
    store.setTabs(
      { scopeId: 'chat-a', tabs: [tab({ terminalId: 'fresh' })], activeTerminalId: 'fresh' },
      'chat-a'
    )

    expect(getCopilotTerminalSession('chat-a')).toMatchObject({
      suspended: false,
      tabs: { activeTerminalId: 'fresh' },
    })
  })
})
