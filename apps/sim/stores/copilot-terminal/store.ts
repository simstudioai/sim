import type {
  ScopedTerminalCommandEvent,
  ScopedTerminalTabsState,
  TerminalTabState,
  TerminalTabsState,
} from '@sim/terminal-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  activateScopedSession,
  discardScopedSession,
  migrateScopedSession,
  withScopedSession,
} from '@/stores/scoped-sessions'

export interface CopilotTerminalSessionData {
  tabs: TerminalTabsState
  /** Exact terminal targeted by each currently running agent command. */
  agentCommandTerminalIds: Record<string, string>
  /** Remount key for immediately settling activity chrome at a stream boundary. */
  activityResetEpoch: number
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
interface CopilotTerminalState {
  activeScopeId: string | null
  sessions: Record<string, CopilotTerminalSessionData>
  /** Recently hard-settled tool ids whose delayed native starts must be ignored. */
  settledAgentCommandIds: string[]
  activateScope: (scopeId: string) => void
  migrateScope: (fromScopeId: string, toScopeId: string) => void
  discardScope: (scopeId: string) => void
  suspendScope: (scopeId: string) => void
  setTabs: (tabs: ScopedTerminalTabsState) => void
  applyCommandEvent: (event: ScopedTerminalCommandEvent) => void
  clearAgentCommands: (
    scopeId: string,
    toolCallIds: readonly string[],
    options: { hardResetActivity: boolean }
  ) => void
}

const MAX_SETTLED_AGENT_COMMAND_IDS = 256

function createInitialSession(): CopilotTerminalSessionData {
  return {
    tabs: { tabs: [], activeTerminalId: null },
    agentCommandTerminalIds: {},
    activityResetEpoch: 0,
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
    Object.keys(session.agentCommandTerminalIds).length === 0
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
  if ((a.agentActiveTerminalId ?? null) !== (b.agentActiveTerminalId ?? null)) return false
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
  return withScopedSession(state, scopeId, createInitialSession, update)
}

export function getCopilotTerminalSession(scopeId: string): CopilotTerminalSessionData {
  return useCopilotTerminalStore.getState().sessions[scopeId] ?? initialSession
}

export const useCopilotTerminalStore = create<CopilotTerminalState>()(
  devtools(
    (set) => ({
      activeScopeId: null,
      sessions: {},
      settledAgentCommandIds: [],
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
              current.tabs.tabs.length === 0 &&
              current.tabs.activeTerminalId === null &&
              Object.keys(current.agentCommandTerminalIds).length === 0
            ) {
              return current
            }
            return {
              tabs: { tabs: [], activeTerminalId: null },
              agentCommandTerminalIds: {},
              activityResetEpoch: (current.activityResetEpoch ?? 0) + 1,
              suspended: true,
            }
          })
        ),
      setTabs: (tabs) =>
        set((state) => {
          return withSession(state, tabs.scopeId, (current) => {
            if (current.suspended) return current
            const liveTerminalIds = new Set(tabs.tabs.map((tab) => tab.terminalId))
            const agentCommandTerminalIds = Object.fromEntries(
              Object.entries(current.agentCommandTerminalIds).filter(([, terminalId]) =>
                liveTerminalIds.has(terminalId)
              )
            )
            const commandsUnchanged =
              Object.keys(agentCommandTerminalIds).length ===
              Object.keys(current.agentCommandTerminalIds).length
            const nextTabs = tabsEqual(current.tabs, tabs) ? current.tabs : tabs
            if (nextTabs === current.tabs && commandsUnchanged) return current
            return { ...current, tabs: nextTabs, agentCommandTerminalIds }
          })
        }),
      applyCommandEvent: (event) =>
        set((state) => {
          const toolCallId = event.toolCallId
          if (!toolCallId) return {}
          const settledIds = state.settledAgentCommandIds ?? []
          const wasHardSettled = settledIds.includes(toolCallId)
          if (event.phase === 'start' && wasHardSettled) return {}
          const sessionUpdate = withSession(state, event.scopeId, (current) => {
            if (current.suspended) return current
            if (event.phase === 'start') {
              if (current.agentCommandTerminalIds[toolCallId] === event.terminalId) return current
              return {
                ...current,
                agentCommandTerminalIds: {
                  ...current.agentCommandTerminalIds,
                  [toolCallId]: event.terminalId,
                },
              }
            }
            if (!(toolCallId in current.agentCommandTerminalIds)) return current
            const { [toolCallId]: _finished, ...agentCommandTerminalIds } =
              current.agentCommandTerminalIds
            return { ...current, agentCommandTerminalIds }
          })
          if (!wasHardSettled) return sessionUpdate
          return {
            ...sessionUpdate,
            settledAgentCommandIds: settledIds.filter((settledId) => settledId !== toolCallId),
          }
        }),
      clearAgentCommands: (scopeId, toolCallIds, options) =>
        set((state) => {
          const ids = new Set(toolCallIds)
          const previousSettledIds = state.settledAgentCommandIds ?? []
          const settledAgentCommandIds = [
            ...previousSettledIds.filter((toolCallId) => !ids.has(toolCallId)),
            ...ids,
          ].slice(-MAX_SETTLED_AGENT_COMMAND_IDS)
          let changed = false
          const sessions = Object.fromEntries(
            Object.entries(state.sessions).map(([id, session]) => {
              const agentCommandTerminalIds = Object.fromEntries(
                Object.entries(session.agentCommandTerminalIds).filter(
                  ([toolCallId]) => !ids.has(toolCallId)
                )
              )
              const commandsChanged =
                Object.keys(agentCommandTerminalIds).length !==
                Object.keys(session.agentCommandTerminalIds).length
              const resetActivity = options.hardResetActivity && (id === scopeId || commandsChanged)
              if (!commandsChanged && !resetActivity) return [id, session]
              changed = true
              return [
                id,
                {
                  ...session,
                  agentCommandTerminalIds,
                  ...(resetActivity
                    ? { activityResetEpoch: (session.activityResetEpoch ?? 0) + 1 }
                    : {}),
                },
              ]
            })
          )
          const settledChanged =
            settledAgentCommandIds.length !== previousSettledIds.length ||
            settledAgentCommandIds.some(
              (toolCallId, index) => toolCallId !== previousSettledIds[index]
            )
          return {
            ...(changed ? { sessions } : {}),
            ...(settledChanged ? { settledAgentCommandIds } : {}),
          }
        }),
    }),
    { name: 'copilot-terminal-store' }
  )
)
