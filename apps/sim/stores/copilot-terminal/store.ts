import type {
  TerminalCommandEvent,
  TerminalSessionState,
} from '@sim/terminal-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/**
 * Renderer-side view of the agent terminal. Deliberately holds no PTY output:
 * xterm.js owns the byte stream and its own scrollback, and pushing hundreds of
 * chunks a second through React state would stall the UI.
 *
 * Named `copilot-terminal` because `stores/terminal` is the workflow editor's
 * execution-log panel, which is unrelated.
 */
interface CopilotTerminalState {
  session: TerminalSessionState | null
  /** Tool call ids whose commands the agent is currently running. */
  agentCommandIds: string[]
  setSessionState: (state: TerminalSessionState) => void
  applyCommandEvent: (event: TerminalCommandEvent) => void
  reset: () => void
}

const initialState = {
  session: null as TerminalSessionState | null,
  agentCommandIds: [] as string[],
}

export const useCopilotTerminalStore = create<CopilotTerminalState>()(
  devtools(
    (set) => ({
      ...initialState,
      setSessionState: (session) =>
        set(() => (session.alive ? { session } : { session, agentCommandIds: [] })),
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
