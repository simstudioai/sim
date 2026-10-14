import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface FullscreenOriginState {
  /** Pathname active immediately before the current fullscreen route, or `null` on a direct load. */
  origin: string | null
  /** Records the page a fullscreen route was launched from. */
  setOrigin: (origin: string | null) => void
}

const initialState = { origin: null as string | null }

/**
 * Holds the pathname a fullscreen route (e.g. `/upgrade`) was launched from.
 * {@link WorkspaceChrome} writes the last non-fullscreen pathname it observes,
 * so any trigger that merely pushes a fullscreen route gets correct
 * return-to-origin without per-call-site wiring.
 */
export const useFullscreenOriginStore = create<FullscreenOriginState>()(
  devtools(
    (set) => ({
      ...initialState,
      setOrigin: (origin) => set({ origin }, false, 'setOrigin'),
    }),
    { name: 'fullscreen-origin-store' }
  )
)
