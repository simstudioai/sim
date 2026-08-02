import type { BrowserPageState, BrowserTabState, BrowserTabsState } from '@sim/browser-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface BrowserSessionData {
  /** Live state of the agent browser's active page, pushed by the desktop app. */
  pageState: BrowserPageState | null
  /** All live tabs in this browser scope. */
  tabs: BrowserTabState[]
  activeTabId: string | null
  /** False after this chat's browser session ends; true again when a new one starts. */
  sessionAlive: boolean
  /** Live views were administratively stopped while the restart descriptor was retained. */
  suspended: boolean
}

interface BrowserSessionState extends BrowserSessionData {
  activeScopeId: string | null
  sessions: Record<string, BrowserSessionData>
  activateScope: (scopeId: string) => void
  migrateScope: (fromScopeId: string, toScopeId: string) => void
  discardScope: (scopeId: string) => void
  suspendScope: (scopeId: string) => void
  setPageState: (state: BrowserPageState) => void
  setTabsState: (state: BrowserTabsState) => void
  setSessionAlive: (alive: boolean, scopeId: string) => void
}

function createInitialSession(): BrowserSessionData {
  return {
    pageState: null,
    tabs: [],
    activeTabId: null,
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
    session.activeTabId === null
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
      activeScopeId: null,
      sessions: {},
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
          return {
            ...createInitialSession(),
            activeScopeId: null,
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
              !current.sessionAlive
            ) {
              return current
            }
            return {
              ...current,
              pageState: null,
              tabs: [],
              activeTabId: null,
              sessionAlive: false,
              suspended: true,
            }
          })
        ),
      setPageState: (pageState) =>
        set((state) => {
          const { scopeId } = pageState
          return withSession(state, scopeId, (current) => {
            if (current.suspended) return current
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
      setTabsState: (tabsState) =>
        set((state) => {
          const { scopeId } = tabsState
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
      setSessionAlive: (alive, scopeId) =>
        set((state) => {
          return withSession(state, scopeId, (current) => {
            if (current.suspended) return current
            if (alive) {
              return current.sessionAlive ? current : { ...current, sessionAlive: true }
            }
            if (
              !current.sessionAlive &&
              current.pageState === null &&
              current.tabs.length === 0 &&
              current.activeTabId === null
            ) {
              return current
            }
            return {
              ...current,
              sessionAlive: false,
              pageState: null,
              tabs: [],
              activeTabId: null,
            }
          })
        }),
    }),
    { name: 'browser-session-store' }
  )
)
