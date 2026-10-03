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
})
