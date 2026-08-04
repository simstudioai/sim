import { beforeEach, describe, expect, it } from 'vitest'
import { getBrowserSession, useBrowserSessionStore } from '@/stores/browser-session/store'

function resetStore(): void {
  const session = {
    pageState: null,
    tabs: [],
    activeTabId: null,
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
