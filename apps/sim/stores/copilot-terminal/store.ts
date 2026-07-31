import type {
  TerminalCommandEvent,
  TerminalTabState,
  TerminalTabsState,
} from '@sim/terminal-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export const LEGACY_TERMINAL_SCOPE = 'legacy'

export interface CopilotTerminalSessionData {
  tabs: TerminalTabsState
  /** Tool call ids whose commands the agent is currently running. */
  agentCommandIds: string[]
  /** Live PTYs were stopped while the restart descriptor was retained. */
  suspended: boolean
}

/**
 * Renderer-side view of the agent terminals. Deliberately holds no PTY output:
 * each xterm instance owns its own byte stream and scrollback, and pushing
 * hundreds of chunks a second through React state would stall the UI.
 *
 * Named `copilot-terminal` because `stores/terminal` is the workflow editor's
 * execution-log panel, which is unrelated.
 */
interface CopilotTerminalState extends CopilotTerminalSessionData {
  activeScopeId: string
  sessions: Record<string, CopilotTerminalSessionData>
  activateScope: (scopeId: string) => void
  migrateScope: (fromScopeId: string, toScopeId: string) => void
  discardScope: (scopeId: string) => void
  suspendScope: (scopeId: string) => void
  setTabs: (tabs: TerminalTabsState, scopeId?: string) => void
  applyCommandEvent: (event: TerminalCommandEvent, scopeId?: string) => void
  reset: (scopeId?: string) => void
}

function createInitialSession(): CopilotTerminalSessionData {
  return {
    tabs: { tabs: [], activeTerminalId: null },
    agentCommandIds: [],
    suspended: false,
  }
}

const initialSession = createInitialSession()

/**
 * Scope activation creates an empty bucket before the desktop answers. That
 * placeholder must not block the pending chat's real terminals from moving to
 * the durable id assigned by the server.
 */
function isPristineSession(session: CopilotTerminalSessionData): boolean {
  return (
    !session.suspended &&
    session.tabs.tabs.length === 0 &&
    session.tabs.activeTerminalId === null &&
    session.agentCommandIds.length === 0
  )
}

/**
 * The desktop app pushes the whole tab list whenever any one tab's metadata
 * moves — the cwd poll alone repeats it once a second. Storing a fresh object
 * each time re-renders the panel and every terminal in it for a push that
 * usually says nothing new, so unchanged state keeps its identity.
 */
function tabsEqual(a: TerminalTabsState, b: TerminalTabsState): boolean {
  if (a.activeTerminalId !== b.activeTerminalId) return false
  if (a.tabs.length !== b.tabs.length) return false
  return a.tabs.every((tab, index) => tabEqual(tab, b.tabs[index]))
}

/**
 * Compares by key rather than by a written-out field list, so a field added to
 * the protocol cannot quietly stop reaching the UI. Every field is a primitive,
 * which makes this total.
 */
function tabEqual(a: TerminalTabState, b: TerminalTabState): boolean {
  const keys = Object.keys(a) as Array<keyof TerminalTabState>
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

function withSession(
  state: CopilotTerminalState,
  scopeId: string,
  update: (current: CopilotTerminalSessionData) => CopilotTerminalSessionData
): Partial<CopilotTerminalState> {
  const current = state.sessions[scopeId] ?? createInitialSession()
  const next = update(current)
  if (next === current) return {}
  const sessions = { ...state.sessions, [scopeId]: next }
  return scopeId === state.activeScopeId ? { ...next, sessions } : { sessions }
}

export function getCopilotTerminalSession(scopeId: string): CopilotTerminalSessionData {
  return useCopilotTerminalStore.getState().sessions[scopeId] ?? initialSession
}

export const useCopilotTerminalStore = create<CopilotTerminalState>()(
  devtools(
    (set) => ({
      ...initialSession,
      activeScopeId: LEGACY_TERMINAL_SCOPE,
      sessions: { [LEGACY_TERMINAL_SCOPE]: initialSession },
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
          const fallback = sessions[LEGACY_TERMINAL_SCOPE] ?? createInitialSession()
          sessions[LEGACY_TERMINAL_SCOPE] = fallback
          return {
            ...fallback,
            activeScopeId: LEGACY_TERMINAL_SCOPE,
            sessions,
          }
        }),
      suspendScope: (scopeId) =>
        set((state) =>
          withSession(state, scopeId, (current) => {
            if (
              current.suspended &&
              current.tabs.tabs.length === 0 &&
              current.tabs.activeTerminalId === null &&
              current.agentCommandIds.length === 0
            ) {
              return current
            }
            return {
              tabs: { tabs: [], activeTerminalId: null },
              agentCommandIds: [],
              suspended: true,
            }
          })
        ),
      setTabs: (tabs, requestedScopeId) =>
        set((state) => {
          const scopeId = requestedScopeId ?? tabs.scopeId ?? state.activeScopeId
          return withSession(state, scopeId, (current) =>
            current.suspended || tabsEqual(current.tabs, tabs) ? current : { ...current, tabs }
          )
        }),
      applyCommandEvent: (event, requestedScopeId) =>
        set((state) => {
          const toolCallId = event.toolCallId
          if (!toolCallId) return {}
          const scopeId = requestedScopeId ?? event.scopeId ?? state.activeScopeId
          return withSession(state, scopeId, (current) => {
            if (current.suspended) return current
            const agentCommandIds =
              event.phase === 'start'
                ? current.agentCommandIds.includes(toolCallId)
                  ? current.agentCommandIds
                  : [...current.agentCommandIds, toolCallId]
                : current.agentCommandIds.filter((id) => id !== toolCallId)
            return agentCommandIds === current.agentCommandIds
              ? current
              : { ...current, agentCommandIds }
          })
        }),
      reset: (requestedScopeId) =>
        set((state) => {
          const scopeId = requestedScopeId ?? state.activeScopeId
          return withSession(state, scopeId, () => createInitialSession())
        }),
    }),
    { name: 'copilot-terminal-store' }
  )
)
