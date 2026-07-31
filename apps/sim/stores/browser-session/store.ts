import type {
  BrowserPageState,
  BrowserPanelSnapshot,
  BrowserTabState,
  BrowserTabsState,
} from '@sim/browser-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export const LEGACY_BROWSER_SCOPE = 'legacy'

export interface BrowserSessionData {
  /** Live state of the agent browser's active page, pushed by the desktop app. */
  pageState: BrowserPageState | null
  /** All live tabs, available on desktop versions with multi-tab support. */
  tabs: BrowserTabState[]
  activeTabId: string | null
  tabsSupported: boolean
  /** Last browser frame captured for display beneath renderer overlays. */
  panelSnapshot: BrowserPanelSnapshot | null
  /** False after this chat's browser session ends; true again when a new one starts. */
  sessionAlive: boolean
  /** Live views were administratively stopped while the restart descriptor was retained. */
  suspended: boolean
}

interface BrowserSessionState extends BrowserSessionData {
  activeScopeId: string
  sessions: Record<string, BrowserSessionData>
  activateScope: (scopeId: string) => void
  migrateScope: (fromScopeId: string, toScopeId: string) => void
  discardScope: (scopeId: string) => void
  suspendScope: (scopeId: string) => void
  setPageState: (state: BrowserPageState, scopeId?: string) => void
  setTabsState: (state: BrowserTabsState, scopeId?: string) => void
  setTabsSupported: (supported: boolean, scopeId?: string) => void
  setPanelSnapshot: (snapshot: BrowserPanelSnapshot, scopeId?: string) => void
  setSessionAlive: (alive: boolean, scopeId?: string) => void
  resetScope: (scopeId?: string) => void
}

function createInitialSession(): BrowserSessionData {
  return {
    pageState: null,
    tabs: [],
    activeTabId: null,
    tabsSupported: false,
    panelSnapshot: null,
    sessionAlive: true,
    suspended: false,
  }
}

const initialSession = createInitialSession()

/**
 * Activation eagerly creates a renderer bucket before the desktop has returned
 * its tab list. An empty response may update capability/liveness flags, but it
 * still carries no browser state and is safe for a pending chat to replace.
 */
function isPristineSession(session: BrowserSessionData): boolean {
  return (
    !session.suspended &&
    session.pageState === null &&
    session.tabs.length === 0 &&
    session.activeTabId === null &&
    session.panelSnapshot === null
  )
}

function tabFieldsEqual(a: BrowserTabState, b: BrowserTabState): boolean {
  return (
    a.tabId === b.tabId &&
    a.url === b.url &&
    a.title === b.title &&
    a.loading === b.loading &&
    a.active === b.active &&
    a.pinned === b.pinned
  )
}

/** True when two tab lists carry the same values, so the old array can be kept. */
function tabsEqual(a: BrowserTabState[], b: BrowserTabState[]): boolean {
  return a.length === b.length && a.every((tab, index) => tabFieldsEqual(tab, b[index]))
}

function pageStateEqual(a: BrowserPageState | null, b: BrowserPageState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.tabId === b.tabId &&
    a.scopeId === b.scopeId &&
    a.url === b.url &&
    a.title === b.title &&
    a.loading === b.loading &&
    a.canGoBack === b.canGoBack &&
    a.canGoForward === b.canGoForward
  )
}

function scopeFor(
  requestedScopeId: string | undefined,
  eventScopeId: string | undefined,
  activeScopeId: string
): string {
  return requestedScopeId ?? eventScopeId ?? activeScopeId
}

function withSession(
  state: BrowserSessionState,
  scopeId: string,
  update: (current: BrowserSessionData) => BrowserSessionData
): Partial<BrowserSessionState> {
  const current = state.sessions[scopeId] ?? createInitialSession()
  const next = update(current)
  if (next === current) return {}
  const sessions = { ...state.sessions, [scopeId]: next }
  return scopeId === state.activeScopeId ? { ...next, sessions } : { sessions }
}

export function getBrowserSession(scopeId: string): BrowserSessionData {
  return useBrowserSessionStore.getState().sessions[scopeId] ?? initialSession
}

export const useBrowserSessionStore = create<BrowserSessionState>()(
  devtools(
    (set) => ({
      ...initialSession,
      activeScopeId: LEGACY_BROWSER_SCOPE,
      sessions: { [LEGACY_BROWSER_SCOPE]: initialSession },
      activateScope: (scopeId) =>
        set((state) => {
          const current = state.sessions[scopeId] ?? createInitialSession()
          const session = current.suspended ? { ...current, suspended: false } : current
          if (scopeId === state.activeScopeId && session === current) return {}
          const sessions =
            state.sessions[scopeId] === session
              ? state.sessions
              : { ...state.sessions, [scopeId]: session }
          return {
            ...session,
            activeScopeId: scopeId,
            sessions,
          }
        }),
      migrateScope: (fromScopeId, toScopeId) =>
        set((state) => {
          if (fromScopeId === toScopeId) return {}
          const source = state.sessions[fromScopeId]
          const destination = state.sessions[toScopeId]
          if (!source || (destination && !isPristineSession(destination))) return {}
          const sessions = { ...state.sessions }
          delete sessions[fromScopeId]
          sessions[toScopeId] = source
          const activeScopeId =
            state.activeScopeId === fromScopeId ? toScopeId : state.activeScopeId
          return activeScopeId === toScopeId
            ? { ...sessions[toScopeId], activeScopeId, sessions }
            : { activeScopeId, sessions }
        }),
      discardScope: (scopeId) =>
        set((state) => {
          if (!state.sessions[scopeId]) return {}
          const sessions = { ...state.sessions }
          delete sessions[scopeId]
          if (state.activeScopeId !== scopeId) return { sessions }
          const fallback = sessions[LEGACY_BROWSER_SCOPE] ?? createInitialSession()
          sessions[LEGACY_BROWSER_SCOPE] = fallback
          return {
            ...fallback,
            activeScopeId: LEGACY_BROWSER_SCOPE,
            sessions,
          }
        }),
      suspendScope: (scopeId) =>
        set((state) =>
          withSession(state, scopeId, (current) => {
            if (
              current.suspended &&
              current.pageState === null &&
              current.tabs.length === 0 &&
              current.activeTabId === null &&
              current.panelSnapshot === null &&
              !current.sessionAlive
            ) {
              return current
            }
            return {
              ...current,
              pageState: null,
              tabs: [],
              activeTabId: null,
              panelSnapshot: null,
              sessionAlive: false,
              suspended: true,
            }
          })
        ),
      setPageState: (pageState, requestedScopeId) =>
        set((state) => {
          const scopeId = scopeFor(requestedScopeId, pageState.scopeId, state.activeScopeId)
          return withSession(state, scopeId, (current) => {
            if (current.suspended) return current
            if (!pageState.tabId) {
              return pageStateEqual(current.pageState, pageState)
                ? current.sessionAlive
                  ? current
                  : { ...current, sessionAlive: true }
                : { ...current, pageState, sessionAlive: true }
            }
            const nextTabs = current.tabs.map((tab) =>
              tab.tabId === pageState.tabId
                ? {
                    ...tab,
                    url: pageState.url,
                    title: pageState.title,
                    loading: pageState.loading,
                    active: true,
                  }
                : tab.active
                  ? { ...tab, active: false }
                  : tab
            )
            const tabs = tabsEqual(current.tabs, nextTabs) ? current.tabs : nextTabs
            if (
              tabs === current.tabs &&
              current.activeTabId === pageState.tabId &&
              current.sessionAlive &&
              pageStateEqual(current.pageState, pageState)
            ) {
              return current
            }
            return {
              ...current,
              pageState,
              sessionAlive: true,
              activeTabId: pageState.tabId,
              tabs,
            }
          })
        }),
      setTabsState: (tabsState, requestedScopeId) =>
        set((state) => {
          const scopeId = scopeFor(requestedScopeId, tabsState.scopeId, state.activeScopeId)
          return withSession(state, scopeId, (current) => {
            if (current.suspended) return current
            const tabs = tabsEqual(current.tabs, tabsState.tabs) ? current.tabs : tabsState.tabs
            const activeTab = tabs.find((tab) => tab.tabId === tabsState.activeTabId)
            const hasCurrentPageState =
              current.pageState?.tabId !== undefined &&
              current.pageState.tabId === tabsState.activeTabId
            const pageState = !activeTab
              ? null
              : hasCurrentPageState
                ? current.pageState
                : {
                    tabId: activeTab.tabId,
                    scopeId,
                    url: activeTab.url,
                    title: activeTab.title,
                    loading: activeTab.loading,
                    canGoBack: false,
                    canGoForward: false,
                  }
            const sessionAlive = tabs.length > 0
            if (
              tabs === current.tabs &&
              tabsState.activeTabId === current.activeTabId &&
              sessionAlive === current.sessionAlive &&
              pageState === current.pageState
            ) {
              return current
            }
            return {
              ...current,
              tabs,
              activeTabId: tabsState.activeTabId,
              sessionAlive,
              pageState,
            }
          })
        }),
      setTabsSupported: (tabsSupported, requestedScopeId) =>
        set((state) => {
          const scopeId = requestedScopeId ?? state.activeScopeId
          return withSession(state, scopeId, (current) =>
            current.tabsSupported === tabsSupported ? current : { ...current, tabsSupported }
          )
        }),
      setPanelSnapshot: (panelSnapshot, requestedScopeId) =>
        set((state) => {
          const scopeId = scopeFor(requestedScopeId, panelSnapshot.scopeId, state.activeScopeId)
          return withSession(state, scopeId, (current) =>
            current.suspended || current.panelSnapshot === panelSnapshot
              ? current
              : { ...current, panelSnapshot }
          )
        }),
      setSessionAlive: (alive, requestedScopeId) =>
        set((state) => {
          const scopeId = requestedScopeId ?? state.activeScopeId
          return withSession(state, scopeId, (current) => {
            if (current.suspended) return current
            if (alive) {
              return current.sessionAlive ? current : { ...current, sessionAlive: true }
            }
            if (
              !current.sessionAlive &&
              current.pageState === null &&
              current.tabs.length === 0 &&
              current.activeTabId === null &&
              current.panelSnapshot === null
            ) {
              return current
            }
            return {
              ...current,
              sessionAlive: false,
              pageState: null,
              tabs: [],
              activeTabId: null,
              panelSnapshot: null,
            }
          })
        }),
      resetScope: (requestedScopeId) =>
        set((state) => {
          const scopeId = requestedScopeId ?? state.activeScopeId
          return withSession(state, scopeId, () => createInitialSession())
        }),
    }),
    { name: 'browser-session-store' }
  )
)
