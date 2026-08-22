import type { ScopedTerminalTabsState, TerminalTabState } from '@sim/terminal-protocol'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCopilotTerminalSession, useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

const TEST_SCOPE = 'chat-a'

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

function tabsState(
  tabs: TerminalTabState[],
  activeTerminalId: string | null,
  scopeId = TEST_SCOPE
): ScopedTerminalTabsState {
  return { scopeId, tabs, activeTerminalId }
}

function activateTestScope() {
  useCopilotTerminalStore.getState().activateScope(TEST_SCOPE)
  return useCopilotTerminalStore.getState()
}

describe('copilot terminal store', () => {
  beforeEach(() => {
    useCopilotTerminalStore.setState({
      activeScopeId: null,
      sessions: {},
      settledAgentCommandIds: [],
    })
  })

  it('starts without an implicit legacy terminal bucket', () => {
    expect(useCopilotTerminalStore.getState()).toMatchObject({
      activeScopeId: null,
      sessions: {},
    })
  })

  /**
   * The desktop app re-pushes the whole tab list on a timer, so an identical
   * push has to keep its identity or the panel and every terminal in it
   * re-render once a second for nothing.
   */
  it('keeps state identity when a push says nothing new', () => {
    const { setTabs } = activateTestScope()
    setTabs(tabsState([tab()], 't1'))
    const first = getCopilotTerminalSession(TEST_SCOPE).tabs

    setTabs(tabsState([tab()], 't1'))

    expect(getCopilotTerminalSession(TEST_SCOPE).tabs).toBe(first)
  })

  it.each([
    ['a command starts', { running: 'bun test' }],
    ['the directory changes', { cwd: '/tmp' }],
    ['the title changes', { title: 'tmp' }],
    ['a full-screen program takes over', { interactive: true }],
    ['the tab stops being active', { active: false }],
    ['tmux attaches', { tmuxSession: 'main' }],
  ])('takes the update when %s', (_case, change) => {
    const { setTabs } = activateTestScope()
    setTabs(tabsState([tab()], 't1'))
    const first = getCopilotTerminalSession(TEST_SCOPE).tabs

    setTabs(tabsState([tab(change)], 't1'))

    expect(getCopilotTerminalSession(TEST_SCOPE).tabs).not.toBe(first)
    expect(getCopilotTerminalSession(TEST_SCOPE).tabs.tabs[0]).toMatchObject(change)
  })

  it('takes the update when the active terminal changes', () => {
    const { setTabs } = activateTestScope()
    const tabs = [tab(), tab({ terminalId: 't2', active: false })]
    setTabs(tabsState(tabs, 't1'))
    const first = getCopilotTerminalSession(TEST_SCOPE).tabs

    setTabs(tabsState(tabs, 't2'))

    expect(getCopilotTerminalSession(TEST_SCOPE).tabs).not.toBe(first)
  })

  it('takes the update when a tab opens or closes', () => {
    const { setTabs } = activateTestScope()
    setTabs(tabsState([tab()], 't1'))
    const first = getCopilotTerminalSession(TEST_SCOPE).tabs

    setTabs(tabsState([tab(), tab({ terminalId: 't2' })], 't1'))

    expect(getCopilotTerminalSession(TEST_SCOPE).tabs).not.toBe(first)
    expect(getCopilotTerminalSession(TEST_SCOPE).tabs.tabs).toHaveLength(2)
  })

  /**
   * The comparator walks keys rather than a written-out field list precisely so
   * that a field added to the protocol cannot quietly stop reaching the UI.
   */
  it('takes the update when a tab carries a field the comparator never named', () => {
    const { setTabs } = activateTestScope()
    setTabs(tabsState([tab()], 't1'))
    const first = getCopilotTerminalSession(TEST_SCOPE).tabs

    setTabs(tabsState([{ ...tab(), somethingNew: true } as TerminalTabState], 't1'))

    expect(getCopilotTerminalSession(TEST_SCOPE).tabs).not.toBe(first)
  })

  it('isolates overlapping terminal ids and late command events by chat', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.setTabs(tabsState([tab({ title: 'A' })], 't1', 'chat-a'))
    store.activateScope('chat-b')
    store.setTabs(tabsState([tab({ title: 'B' })], 't1', 'chat-b'))

    store.applyCommandEvent({
      scopeId: 'chat-a',
      terminalId: 't1',
      phase: 'start',
      command: 'bun test',
      toolCallId: 'tool-a',
    })

    expect(useCopilotTerminalStore.getState().activeScopeId).toBe('chat-b')
    expect(getCopilotTerminalSession('chat-b').tabs.tabs[0].title).toBe('B')
    expect(getCopilotTerminalSession('chat-b').agentCommandTerminalIds).toEqual({})
    expect(getCopilotTerminalSession('chat-a').agentCommandTerminalIds).toEqual({
      'tool-a': 't1',
    })

    store.activateScope('chat-a')
    expect(useCopilotTerminalStore.getState().activeScopeId).toBe('chat-a')
    expect(getCopilotTerminalSession('chat-a').tabs.tabs[0].title).toBe('A')
    expect(getCopilotTerminalSession('chat-a').agentCommandTerminalIds).toEqual({
      'tool-a': 't1',
    })
  })

  it('tracks each running command on its exact terminal and clears closed targets', () => {
    const store = activateTestScope()
    store.setTabs(tabsState([tab(), tab({ terminalId: 't2', title: 'two', active: false })], 't1'))
    store.applyCommandEvent({
      scopeId: TEST_SCOPE,
      terminalId: 't1',
      phase: 'start',
      command: 'bun test',
      toolCallId: 'tool-a',
    })
    store.applyCommandEvent({
      scopeId: TEST_SCOPE,
      terminalId: 't2',
      phase: 'start',
      command: 'bun dev',
      toolCallId: 'tool-b',
    })

    expect(getCopilotTerminalSession(TEST_SCOPE).agentCommandTerminalIds).toEqual({
      'tool-a': 't1',
      'tool-b': 't2',
    })

    store.setTabs(tabsState([tab({ terminalId: 't2', title: 'two' })], 't2'))

    expect(getCopilotTerminalSession(TEST_SCOPE).agentCommandTerminalIds).toEqual({
      'tool-b': 't2',
    })
  })

  it('moves pending terminals onto the resolved chat id', () => {
    const store = useCopilotTerminalStore.getState()
    store.setTabs(tabsState([tab({ title: 'Pending' })], 't1', 'pending:workspace-1'))
    store.activateScope('pending:workspace-1')

    store.migrateScope('pending:workspace-1', 'chat-1')

    expect(useCopilotTerminalStore.getState().activeScopeId).toBe('chat-1')
    expect(useCopilotTerminalStore.getState().sessions['pending:workspace-1']).toBeUndefined()
    expect(getCopilotTerminalSession('chat-1').tabs.tabs[0].title).toBe('Pending')
  })

  it('replaces a pristine durable bucket created before pending migration finishes', () => {
    const store = useCopilotTerminalStore.getState()
    store.setTabs(tabsState([tab({ title: 'Pending' })], 't1', 'pending:new'))

    store.activateScope('chat-1')
    store.setTabs(tabsState([], null, 'chat-1'))
    store.migrateScope('pending:new', 'chat-1')

    expect(useCopilotTerminalStore.getState().sessions['pending:new']).toBeUndefined()
    expect(useCopilotTerminalStore.getState().activeScopeId).toBe('chat-1')
    expect(getCopilotTerminalSession('chat-1').tabs.tabs[0].title).toBe('Pending')
  })

  it('removes an abandoned pending group without touching another chat', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.setTabs(tabsState([tab({ title: 'A' })], 't1', 'chat-a'))
    store.activateScope('pending:new')

    store.discardScope('pending:new')

    expect(useCopilotTerminalStore.getState().sessions['pending:new']).toBeUndefined()
    expect(getCopilotTerminalSession('chat-a').tabs.tabs[0].title).toBe('A')
    expect(useCopilotTerminalStore.getState().activeScopeId).toBeNull()
  })

  it('clears live terminal ids while suspended and ignores late native events', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.setTabs(tabsState([tab()], 't1', 'chat-a'))
    store.applyCommandEvent({
      scopeId: 'chat-a',
      terminalId: 't1',
      phase: 'start',
      command: 'bun test',
      toolCallId: 'tool-a',
    })

    store.suspendScope('chat-a')
    store.setTabs(tabsState([tab({ terminalId: 'stale' })], 'stale', 'chat-a'))

    expect(getCopilotTerminalSession('chat-a')).toEqual({
      tabs: { tabs: [], activeTerminalId: null },
      agentCommandTerminalIds: {},
      activityResetEpoch: 1,
      suspended: true,
    })
  })

  it('stale-settles exact commands without resetting a newer command in the same chat', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope(TEST_SCOPE)
    store.applyCommandEvent({
      scopeId: TEST_SCOPE,
      terminalId: 't1',
      phase: 'start',
      command: 'old',
      toolCallId: 'tool-old',
    })
    store.applyCommandEvent({
      scopeId: TEST_SCOPE,
      terminalId: 't1',
      phase: 'start',
      command: 'new',
      toolCallId: 'tool-new',
    })

    store.clearAgentCommands(TEST_SCOPE, ['tool-old'], { hardResetActivity: false })

    expect(getCopilotTerminalSession(TEST_SCOPE)).toMatchObject({
      agentCommandTerminalIds: { 'tool-new': 't1' },
      activityResetEpoch: 0,
    })
  })

  it('ignores a delayed native start after its stream hard-settles', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope(TEST_SCOPE)

    store.clearAgentCommands(TEST_SCOPE, ['tool-late'], { hardResetActivity: true })
    expect(getCopilotTerminalSession(TEST_SCOPE).activityResetEpoch).toBe(1)
    store.applyCommandEvent({
      scopeId: TEST_SCOPE,
      terminalId: 't1',
      phase: 'start',
      command: 'late',
      toolCallId: 'tool-late',
    })

    expect(getCopilotTerminalSession(TEST_SCOPE).agentCommandTerminalIds).toEqual({})

    store.applyCommandEvent({
      scopeId: TEST_SCOPE,
      terminalId: 't1',
      phase: 'end',
      command: 'late',
      toolCallId: 'tool-late',
    })
    expect(useCopilotTerminalStore.getState().settledAgentCommandIds).not.toContain('tool-late')
  })

  it('clears suspension on explicit activation, including the already-active scope', () => {
    const store = useCopilotTerminalStore.getState()
    store.activateScope('chat-a')
    store.suspendScope('chat-a')

    store.activateScope('chat-a')
    store.setTabs(tabsState([tab({ terminalId: 'fresh' })], 'fresh', 'chat-a'))

    expect(getCopilotTerminalSession('chat-a')).toMatchObject({
      suspended: false,
      tabs: { activeTerminalId: 'fresh' },
    })
  })
})
