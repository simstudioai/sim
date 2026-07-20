import { beforeEach, describe, expect, it } from 'vitest'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

describe('browser session store', () => {
  beforeEach(() => {
    useBrowserSessionStore.setState({
      pageState: null,
      tabs: [],
      activeTabId: null,
      tabsSupported: false,
      panelSnapshot: null,
      sessionAlive: true,
    })
  })

  it('restores the active page summary from an initial tab-list read', () => {
    useBrowserSessionStore.getState().setTabsState({
      activeTabId: '2',
      tabs: [
        {
          tabId: '1',
          title: 'Docs',
          url: 'https://docs.sim.ai',
          loading: false,
          active: false,
        },
        {
          tabId: '2',
          title: 'Dashboard',
          url: 'https://sim.ai/workspace',
          loading: true,
          active: true,
        },
      ],
    })

    expect(useBrowserSessionStore.getState().pageState).toEqual({
      tabId: '2',
      title: 'Dashboard',
      url: 'https://sim.ai/workspace',
      loading: true,
      canGoBack: false,
      canGoForward: false,
    })
  })

  it('clears page state when the last tab closes', () => {
    useBrowserSessionStore.setState({
      pageState: {
        tabId: '1',
        title: 'Docs',
        url: 'https://docs.sim.ai',
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    })

    useBrowserSessionStore.getState().setTabsState({ tabs: [], activeTabId: null })

    expect(useBrowserSessionStore.getState().pageState).toBeNull()
  })
})
