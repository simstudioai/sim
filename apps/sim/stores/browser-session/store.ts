import type {
  BrowserPageState,
  BrowserPanelSnapshot,
  BrowserTabState,
  BrowserTabsState,
} from '@sim/browser-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface BrowserSessionState {
  /** Live state of the agent browser's active page, pushed by the desktop app. */
  pageState: BrowserPageState | null
  /** All live tabs, available on desktop versions with multi-tab support. */
  tabs: BrowserTabState[]
  activeTabId: string | null
  tabsSupported: boolean
  /** Last browser frame captured for display beneath renderer overlays. */
  panelSnapshot: BrowserPanelSnapshot | null
  /** False after the browser session ends; true again when a new one starts. */
  sessionAlive: boolean
  setPageState: (state: BrowserPageState) => void
  setTabsState: (state: BrowserTabsState) => void
  setTabsSupported: (supported: boolean) => void
  setPanelSnapshot: (snapshot: BrowserPanelSnapshot) => void
  setSessionAlive: (alive: boolean) => void
}

const initialState = {
  pageState: null as BrowserPageState | null,
  tabs: [] as BrowserTabState[],
  activeTabId: null as string | null,
  tabsSupported: false,
  panelSnapshot: null as BrowserPanelSnapshot | null,
  sessionAlive: true,
}

export const useBrowserSessionStore = create<BrowserSessionState>()(
  devtools(
    (set) => ({
      ...initialState,
      setPageState: (pageState) =>
        set((state) => ({
          pageState,
          sessionAlive: true,
          ...(pageState.tabId
            ? {
                activeTabId: pageState.tabId,
                tabs: state.tabs.map((tab) =>
                  tab.tabId === pageState.tabId
                    ? {
                        ...tab,
                        url: pageState.url,
                        title: pageState.title,
                        loading: pageState.loading,
                        active: true,
                      }
                    : { ...tab, active: false }
                ),
              }
            : {}),
        })),
      setTabsState: ({ tabs, activeTabId }) =>
        set((state) => {
          const activeTab = tabs.find((tab) => tab.tabId === activeTabId)
          const hasCurrentPageState =
            state.pageState?.tabId !== undefined && state.pageState.tabId === activeTabId
          return {
            tabs,
            activeTabId,
            ...(tabs.length > 0 ? { sessionAlive: true } : {}),
            ...(!activeTab
              ? { pageState: null }
              : hasCurrentPageState
                ? {}
                : {
                    pageState: {
                      tabId: activeTab.tabId,
                      url: activeTab.url,
                      title: activeTab.title,
                      loading: activeTab.loading,
                      canGoBack: false,
                      canGoForward: false,
                    },
                  }),
          }
        }),
      setTabsSupported: (tabsSupported) => set({ tabsSupported }),
      setPanelSnapshot: (panelSnapshot) => set({ panelSnapshot }),
      setSessionAlive: (alive) =>
        set(
          alive
            ? { sessionAlive: true }
            : {
                sessionAlive: false,
                pageState: null,
                tabs: [],
                activeTabId: null,
                panelSnapshot: null,
              }
        ),
    }),
    { name: 'browser-session-store' }
  )
)
