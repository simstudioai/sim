import type { BrowserPageState } from '@sim/browser-protocol'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface BrowserSessionState {
  /** Live state of the agent browser's active page, pushed by the desktop app. */
  pageState: BrowserPageState | null
  /** False after the browser session ends; true again when a new one starts. */
  sessionAlive: boolean
  setPageState: (state: BrowserPageState) => void
  setSessionAlive: (alive: boolean) => void
  reset: () => void
}

const initialState = { pageState: null as BrowserPageState | null, sessionAlive: true }

export const useBrowserSessionStore = create<BrowserSessionState>()(
  devtools(
    (set) => ({
      ...initialState,
      setPageState: (pageState) => set({ pageState, sessionAlive: true }),
      setSessionAlive: (alive) => set({ sessionAlive: alive }),
      reset: () => set(initialState),
    }),
    { name: 'browser-session-store' }
  )
)
