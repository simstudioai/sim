import type { TerminalCommandEvent, TerminalTabsState } from '@sim/terminal-protocol'
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

export const useCopilotTerminalStore = create<CopilotTerminalState>()(
  devtools(
    (set) => ({
      ...initialState,
      setTabs: (tabs) => set({ tabs }),
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
