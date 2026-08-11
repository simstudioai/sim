import type { BrowserPageState, BrowserTabState, BrowserTabsState } from '@sim/browser-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  activateScopedSession,
  discardScopedSession,
  migrateScopedSession,
  withScopedSession,
} from '@/stores/scoped-sessions'

export interface BrowserSessionData {
  /** Live state of the agent browser's active page, pushed by the desktop app. */
  pageState: BrowserPageState | null
  /** All live tabs in this browser scope. */
  tabs: BrowserTabState[]
  activeTabId: string | null
  automationTabId: string | null
  automationActive: boolean
  automationNeedsAttention: boolean
  /** Browser-subagent spans currently working in this chat scope. */
  agentRunIds: string[]
  /** False after this chat's browser session ends; true again when a new one starts. */
  sessionAlive: boolean
  /** Live views were administratively stopped while the restart descriptor was retained. */
  suspended: boolean
}

interface BrowserSessionState {
  activeScopeId: string | null
  sessions: Record<string, BrowserSessionData>
  activateScope: (scopeId: string) => void
  migrateScope: (fromScopeId: string, toScopeId: string) => void
  discardScope: (scopeId: string) => void
  suspendScope: (scopeId: string) => void
  setPageState: (state: BrowserPageState) => void
  setTabsState: (state: BrowserTabsState) => void
  setAgentRunActive: (scopeId: string, runId: string, active: boolean) => void
  clearAgentRuns: (scopeId: string) => void
  clearAgentRunIds: (
    runIds: readonly string[],
    options?: { hardResetScopeIds?: readonly string[] }
  ) => void
  reorderTab: (scopeId: string, tabId: string, targetIndex: number) => void
  setSessionAlive: (alive: boolean, scopeId: string) => void
}

function createInitialSession(): BrowserSessionData {
  return {
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
    session.automationTabId === null &&
    !session.automationActive &&
    !session.automationNeedsAttention &&
    session.agentRunIds.length === 0
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

/**
 * A full native tab-list push can briefly report an empty title for a settled
 * background WebContents even though its richer page-state push already gave
 * us the title. Keep that known title only while the tab remains on the same
 * URL and is not loading; navigation is still free to replace it.
 */
function retainSettledTabTitles(
  currentTabs: BrowserTabState[],
  incomingTabs: BrowserTabState[]
): BrowserTabState[] {
  const currentById = new Map(currentTabs.map((tab) => [tab.tabId, tab]))
  return incomingTabs.map((incoming) => {
    const current = currentById.get(incoming.tabId)
    if (
      incoming.title.trim() === '' &&
      !incoming.loading &&
      current?.url === incoming.url &&
      current.title.trim() !== ''
    ) {
      return { ...incoming, title: current.title }
    }
    return incoming
  })
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
  return withScopedSession(state, scopeId, createInitialSession, update)
}

export function getBrowserSession(scopeId: string): BrowserSessionData {
  return useBrowserSessionStore.getState().sessions[scopeId] ?? initialSession
}

export const useBrowserSessionStore = create<BrowserSessionState>()(
  devtools(
    (set) => ({
      activeScopeId: null,
      sessions: {},
      activateScope: (scopeId) =>
        set((state) => activateScopedSession(state, scopeId, createInitialSession)),
      migrateScope: (fromScopeId, toScopeId) =>
        set((state) => migrateScopedSession(state, fromScopeId, toScopeId, isPristineSession)),
      discardScope: (scopeId) => set((state) => discardScopedSession(state, scopeId)),
      suspendScope: (scopeId) =>
        set((state) =>
          withSession(state, scopeId, (current) => {
            if (
              current.suspended &&
              current.pageState === null &&
              current.tabs.length === 0 &&
              current.activeTabId === null &&
              current.automationTabId === null &&
              !current.automationActive &&
              !current.automationNeedsAttention &&
              current.agentRunIds.length === 0 &&
              !current.sessionAlive
            ) {
              return current
            }
            return {
              ...current,
              pageState: null,
              tabs: [],
              activeTabId: null,
              automationTabId: null,
              automationActive: false,
              automationNeedsAttention: false,
              agentRunIds: [],
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
            const incomingTabs = retainSettledTabTitles(current.tabs, tabsState.tabs)
            const tabs = tabsEqual(current.tabs, incomingTabs) ? current.tabs : incomingTabs
            const activeTab = tabs.find((tab) => tab.tabId === tabsState.activeTabId)
            const reportedAutomationTabId = tabsState.automationTabId ?? null
            const automationTabId =
              reportedAutomationTabId ??
              (current.agentRunIds.length > 0
                ? tabs.some((tab) => tab.tabId === current.automationTabId)
                  ? current.automationTabId
                  : tabsState.activeTabId
                : null)
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
              automationTabId === current.automationTabId &&
              (tabsState.automationActive ?? false) === current.automationActive &&
              (tabsState.automationNeedsAttention ?? false) === current.automationNeedsAttention &&
              sessionAlive === current.sessionAlive &&
              pageState === current.pageState
            ) {
              return current
            }
            return {
              ...current,
              tabs,
              activeTabId: tabsState.activeTabId,
              automationTabId,
              automationActive: tabsState.automationActive ?? false,
              automationNeedsAttention: tabsState.automationNeedsAttention ?? false,
              sessionAlive,
              pageState,
            }
          })
        }),
      setAgentRunActive: (scopeId, runId, active) =>
        set((state) => {
          if (!runId) return state
          if (!active) {
            let changed = false
            const sessions = Object.fromEntries(
              Object.entries(state.sessions).map(([id, session]) => {
                if (!session.agentRunIds.includes(runId)) return [id, session]
                changed = true
                const agentRunIds = session.agentRunIds.filter((entry) => entry !== runId)
                return [
                  id,
                  {
                    ...session,
                    agentRunIds,
                    automationTabId:
                      agentRunIds.length === 0 && !session.automationActive
                        ? null
                        : session.automationTabId,
                  },
                ]
              })
            )
            return changed ? { sessions } : state
          }
          return withSession(state, scopeId, (current) => {
            if (current.suspended || current.agentRunIds.includes(runId)) return current
            return {
              ...current,
              agentRunIds: [...current.agentRunIds, runId],
              automationTabId: current.automationTabId ?? current.activeTabId,
            }
          })
        }),
      clearAgentRuns: (scopeId) =>
        set((state) =>
          withSession(state, scopeId, (current) =>
            current.agentRunIds.length === 0
              ? current
              : {
                  ...current,
                  agentRunIds: [],
                  automationTabId: current.automationActive ? current.automationTabId : null,
                }
          )
        ),
      clearAgentRunIds: (runIds, options) =>
        set((state) => {
          const ids = new Set(runIds)
          const hardResetScopes = new Set(options?.hardResetScopeIds ?? [])
          if (ids.size === 0 && hardResetScopes.size === 0) return {}
          let changed = false
          const sessions = Object.fromEntries(
            Object.entries(state.sessions).map(([id, session]) => {
              const agentRunIds = session.agentRunIds.filter((runId) => !ids.has(runId))
              const hardResetActivity = hardResetScopes.has(id)
              if (agentRunIds.length === session.agentRunIds.length && !hardResetActivity) {
                return [id, session]
              }
              changed = true
              return [
                id,
                {
                  ...session,
                  agentRunIds,
                  ...(hardResetActivity
                    ? { automationActive: false, automationNeedsAttention: false }
                    : {}),
                  automationTabId:
                    agentRunIds.length === 0 && (hardResetActivity || !session.automationActive)
                      ? null
                      : session.automationTabId,
                },
              ]
            })
          )
          return changed ? { sessions } : {}
        }),
      reorderTab: (scopeId, tabId, targetIndex) =>
        set((state) =>
          withSession(state, scopeId, (current) => {
            const currentIndex = current.tabs.findIndex((tab) => tab.tabId === tabId)
            if (currentIndex < 0 || !Number.isFinite(targetIndex)) return current
            const nextIndex = Math.max(
              0,
              Math.min(current.tabs.length - 1, Math.trunc(targetIndex))
            )
            if (currentIndex === nextIndex) return current
            const tabs = [...current.tabs]
            const [tab] = tabs.splice(currentIndex, 1)
            tabs.splice(nextIndex, 0, tab)
            return { ...current, tabs }
          })
        ),
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
              current.activeTabId === null &&
              current.automationTabId === null &&
              !current.automationActive &&
              !current.automationNeedsAttention &&
              current.agentRunIds.length === 0
            ) {
              return current
            }
            return {
              ...current,
              sessionAlive: false,
              pageState: null,
              tabs: [],
              activeTabId: null,
              automationTabId: null,
              automationActive: false,
              automationNeedsAttention: false,
              agentRunIds: [],
            }
          })
        }),
    }),
    { name: 'browser-session-store' }
  )
)
