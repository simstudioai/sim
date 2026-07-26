import type {
  TerminalCommandEvent,
  TerminalTabState,
  TerminalTabsState,
} from '@sim/terminal-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/**
 * Renderer-side view of the agent terminals. Deliberately holds no PTY output:
 * each xterm instance owns its own byte stream and scrollback, and pushing
 * hundreds of chunks a second through React state would stall the UI.
 *
 * Named `copilot-terminal` because `stores/terminal` is the workflow editor's
 * execution-log panel, which is unrelated.
 */
interface CopilotTerminalState {
  tabs: TerminalTabsState
  /** Tool call ids whose commands the agent is currently running. */
  agentCommandIds: string[]
  setTabs: (tabs: TerminalTabsState) => void
  applyCommandEvent: (event: TerminalCommandEvent) => void
  reset: () => void
}

const initialState = {
  tabs: { tabs: [], activeTerminalId: null } as TerminalTabsState,
  agentCommandIds: [] as string[],
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

export const useCopilotTerminalStore = create<CopilotTerminalState>()(
  devtools(
    (set) => ({
      ...initialState,
      setTabs: (tabs) => set((state) => (tabsEqual(state.tabs, tabs) ? {} : { tabs })),
      applyCommandEvent: (event) =>
        set((state) => {
          if (!event.toolCallId) return {}
          const toolCallId = event.toolCallId
          return event.phase === 'start'
            ? {
                agentCommandIds: state.agentCommandIds.includes(toolCallId)
                  ? state.agentCommandIds
                  : [...state.agentCommandIds, toolCallId],
              }
            : { agentCommandIds: state.agentCommandIds.filter((id) => id !== toolCallId) }
        }),
      reset: () => set({ ...initialState }),
    }),
    { name: 'copilot-terminal-store' }
  )
)
