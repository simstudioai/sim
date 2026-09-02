import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export const MOTHERSHIP_MODES = ['build', 'search'] as const

export type MothershipMode = (typeof MOTHERSHIP_MODES)[number]

interface MothershipModeState {
  mode: MothershipMode
  /** Sources mode's Assistant choice: Sim answers from the sources instead of listing them. */
  assistant: boolean
  setMode: (mode: MothershipMode) => void
  setAssistant: (assistant: boolean) => void
  reset: () => void
}

const initialState: Pick<MothershipModeState, 'mode' | 'assistant'> = {
  mode: 'build',
  assistant: false,
}

/**
 * The chat composer's mode — Build (default) or Sources (`search`) — and
 * Sources mode's Search / Assistant choice, read by the input's controls and by
 * the suggested actions beneath the input. Search lists the matching documents
 * with no turn at all; Assistant makes a query a turn of the agent grounded in
 * the searched sources.
 *
 * A store rather than `Home` state because `Home` remounts per chat
 * (`key={chatId}`) and the new-chat → `/chat/[chatId]` handoff must carry the
 * mode across. Not a URL param: that handoff rewrites the path with
 * `history.replaceState`, which would drop a query key, and the mode is a
 * composer preference rather than a destination (the same reasoning that keeps
 * canvas mode out of the URL). Deliberately not persisted, so the server render
 * and the first client render agree — a persisted `search` would hydrate over
 * server-rendered Build chrome.
 */
export const useMothershipModeStore = create<MothershipModeState>()(
  devtools(
    (set) => ({
      ...initialState,
      setMode: (mode) => set({ mode }),
      setAssistant: (assistant) => set({ assistant }),
      reset: () => set(initialState),
    }),
    { name: 'mothership-mode-store' }
  )
)
