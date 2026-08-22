import { beforeEach, describe, expect, it } from 'vitest'
import { getBrowserSession, useBrowserSessionStore } from '@/stores/browser-session/store'

function resetStore(): void {
  const session = {
    pageState: null,
    tabs: [],
    activeTabId: null,
    automationTabId: null,
    automationActive: false,
    automationNeedsAttention: false,
    agentRunIds: [],
    sessionAlive: true,
    suspended: false,
  }
  useBrowserSessionStore.setState({
    activeScopeId: 'chat-test',
    sessions: { 'chat-test': session },
  })
}

describe('browser session store', () => {
  beforeEach(resetStore)

  it('restores the active page summary from an initial tab-list read', () => {
    useBrowserSessionStore.getState().setTabsState({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [
        {
          tabId: '1',
          title: 'Docs',
          url: 'https://docs.sim.ai',
          loading: false,
          active: false,
          pinned: false,
        },
        {
          tabId: '2',
          title: 'Dashboard',
          url: 'https://sim.ai/workspace',
          loading: true,
          active: true,
          pinned: false,
        },
      ],
    })

    expect(getBrowserSession('chat-test').pageState).toEqual({
      tabId: '2',
      scopeId: 'chat-test',
      title: 'Dashboard',
      url: 'https://sim.ai/workspace',
      loading: true,
      canGoBack: false,
      canGoForward: false,
    })
  })

  it('clears page state when the last tab closes', () => {
    useBrowserSessionStore.getState().setPageState({
      tabId: '1',
      scopeId: 'chat-test',
      title: 'Docs',
      url: 'https://docs.sim.ai',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })

    useBrowserSessionStore
      .getState()
      .setTabsState({ scopeId: 'chat-test', tabs: [], activeTabId: null })

    expect(getBrowserSession('chat-test').pageState).toBeNull()
    expect(getBrowserSession('chat-test').sessionAlive).toBe(false)
  })

  it('reorders tabs optimistically without changing the active page', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [
        {
          tabId: '1',
          title: 'One',
          url: 'https://one.example',
          loading: false,
          active: false,
          pinned: false,
        },
        {
          tabId: '2',
          title: 'Two',
          url: 'https://two.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    store.reorderTab('chat-test', '2', 0)

    expect(getBrowserSession('chat-test').tabs.map((tab) => tab.tabId)).toEqual(['2', '1'])
    expect(getBrowserSession('chat-test').activeTabId).toBe('2')
    expect(getBrowserSession('chat-test').pageState?.tabId).toBe('2')
  })

  it('retains a settled tab title when opening a new tab pushes a temporary blank title', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: '1',
      tabs: [
        {
          tabId: '1',
          title: 'Example docs',
          url: 'https://example.com/docs',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    // Electron publishes the new active page before its following full-list
    // push. The new id is not in the renderer's old list yet.
    store.setPageState({
      tabId: '2',
      scopeId: 'chat-test',
      title: '',
      url: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })

    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: '2',
      tabs: [
        {
          tabId: '1',
          title: '',
          url: 'https://example.com/docs',
          loading: false,
          active: false,
          pinned: false,
        },
        {
          tabId: '2',
          title: '',
          url: '',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    expect(getBrowserSession('chat-test').tabs).toMatchObject([
      { tabId: '1', title: 'Example docs', active: false },
      { tabId: '2', title: '', active: true },
    ])
  })

  it('keeps overlapping tab ids isolated while chats switch', () => {
    const store = useBrowserSessionStore.getState()
    store.activateScope('chat-a')
    store.setTabsState({
      scopeId: 'chat-a',
      activeTabId: '1',
      tabs: [
        {
          tabId: '1',
          title: 'A',
          url: 'https://a.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    store.activateScope('chat-b')
    store.setTabsState({
      scopeId: 'chat-b',
      activeTabId: '1',
      tabs: [
        {
          tabId: '1',
          title: 'B',
          url: 'https://b.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    // A late event from A updates A's bucket without changing the active B
    // projection, even though both desktop sessions use tab id "1".
    store.setPageState({
      tabId: '1',
      scopeId: 'chat-a',
      title: 'A updated',
      url: 'https://a.example/updated',
      loading: false,
      canGoBack: true,
      canGoForward: false,
    })

    expect(useBrowserSessionStore.getState().activeScopeId).toBe('chat-b')
    expect(getBrowserSession('chat-a').pageState?.title).toBe('A updated')
    expect(getBrowserSession('chat-b').pageState?.title).toBe('B')

    store.activateScope('chat-a')
    expect(useBrowserSessionStore.getState().activeScopeId).toBe('chat-a')
    expect(getBrowserSession('chat-a').pageState?.title).toBe('A updated')
  })

  it('moves a pending new-chat bucket to its resolved chat id', () => {
    const store = useBrowserSessionStore.getState()
    store.setPageState({
      tabId: '1',
      scopeId: 'pending:workspace-1',
      title: 'Pending',
      url: 'https://pending.example',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })
    store.activateScope('pending:workspace-1')

    store.migrateScope('pending:workspace-1', 'chat-1')

    expect(useBrowserSessionStore.getState().activeScopeId).toBe('chat-1')
    expect(useBrowserSessionStore.getState().sessions['pending:workspace-1']).toBeUndefined()
    expect(getBrowserSession('chat-1').pageState?.url).toBe('https://pending.example')
  })

  it('keeps browser-agent activity across tool gaps and clears it by exact run', () => {
    const store = useBrowserSessionStore.getState()

    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: 'tab-1',
      tabs: [
        {
          tabId: 'tab-1',
          title: 'Current page',
          url: 'https://example.com',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    store.setAgentRunActive('chat-test', 'browser-run-1', true)
    store.setAgentRunActive('chat-test', 'browser-run-2', true)
    expect(getBrowserSession('chat-test').agentRunIds).toEqual(['browser-run-1', 'browser-run-2'])
    expect(getBrowserSession('chat-test').automationTabId).toBe('tab-1')

    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: 'tab-1',
      automationTabId: 'tab-1',
      automationActive: true,
      tabs: getBrowserSession('chat-test').tabs,
    })
    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: 'tab-1',
      automationTabId: null,
      automationActive: false,
      tabs: getBrowserSession('chat-test').tabs,
    })
    expect(getBrowserSession('chat-test').automationTabId).toBe('tab-1')

    store.setAgentRunActive('ignored-after-migration', 'browser-run-1', false)
    expect(getBrowserSession('chat-test').agentRunIds).toEqual(['browser-run-2'])

    store.clearAgentRuns('chat-test')
    expect(getBrowserSession('chat-test').agentRunIds).toEqual([])
    expect(getBrowserSession('chat-test').automationTabId).toBeNull()
  })

  it('hard-settles an old stream without clearing a newer browser run', () => {
    const store = useBrowserSessionStore.getState()
    store.setTabsState({
      scopeId: 'chat-test',
      activeTabId: 'tab-1',
      automationTabId: 'tab-1',
      automationActive: true,
      automationNeedsAttention: true,
      tabs: [
        {
          tabId: 'tab-1',
          title: 'Current page',
          url: 'https://example.com',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })
    store.setAgentRunActive('chat-test', 'browser-run-old', true)
    store.setAgentRunActive('chat-test', 'browser-run-new', true)

    store.clearAgentRunIds(['browser-run-old'], { hardResetScopeIds: ['chat-test'] })

    expect(getBrowserSession('chat-test')).toMatchObject({
      agentRunIds: ['browser-run-new'],
      automationTabId: 'tab-1',
      automationActive: false,
      automationNeedsAttention: false,
    })
  })

  it('replaces a pristine durable bucket created before pending migration finishes', () => {
    const store = useBrowserSessionStore.getState()
    store.setPageState({
      tabId: '1',
      scopeId: 'pending:new',
      title: 'Pending',
      url: 'https://pending.example',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })

    store.activateScope('chat-1')
    store.setTabsState({ scopeId: 'chat-1', tabs: [], activeTabId: null })
    store.migrateScope('pending:new', 'chat-1')

    expect(useBrowserSessionStore.getState().sessions['pending:new']).toBeUndefined()
    expect(useBrowserSessionStore.getState().activeScopeId).toBe('chat-1')
    expect(getBrowserSession('chat-1').pageState?.url).toBe('https://pending.example')
  })

  it('removes an abandoned pending bucket without touching another chat', () => {
    const store = useBrowserSessionStore.getState()
    store.activateScope('chat-a')
    store.activateScope('pending:new')

    store.discardScope('pending:new')

    expect(useBrowserSessionStore.getState().sessions['pending:new']).toBeUndefined()
    expect(useBrowserSessionStore.getState().sessions['chat-a']).toBeDefined()
    expect(useBrowserSessionStore.getState().activeScopeId).toBeNull()
  })

  it('clears live browser ids while suspended and ignores late native events', () => {
    const store = useBrowserSessionStore.getState()
    store.activateScope('chat-a')
    store.setTabsState({
      scopeId: 'chat-a',
      activeTabId: '1',
      tabs: [
        {
          tabId: '1',
          title: 'A',
          url: 'https://a.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    store.suspendScope('chat-a')
    store.setTabsState({
      scopeId: 'chat-a',
      activeTabId: 'stale',
      tabs: [
        {
          tabId: 'stale',
          title: 'Stale',
          url: 'https://stale.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    expect(getBrowserSession('chat-a')).toMatchObject({
      suspended: true,
      tabs: [],
      activeTabId: null,
      pageState: null,
      sessionAlive: false,
    })
  })

  it('clears suspension on explicit activation, including the already-active scope', () => {
    const store = useBrowserSessionStore.getState()
    store.activateScope('chat-a')
    store.suspendScope('chat-a')

    store.activateScope('chat-a')
    store.setTabsState({
      scopeId: 'chat-a',
      activeTabId: 'fresh',
      tabs: [
        {
          tabId: 'fresh',
          title: 'Fresh',
          url: 'https://fresh.example',
          loading: false,
          active: true,
          pinned: false,
        },
      ],
    })

    expect(getBrowserSession('chat-a')).toMatchObject({
      suspended: false,
      activeTabId: 'fresh',
      sessionAlive: true,
    })
  })
})
