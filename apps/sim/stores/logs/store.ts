import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Width constraints for the log details panel.
 */
export const MIN_LOG_DETAILS_WIDTH = 400
export const DEFAULT_LOG_DETAILS_WIDTH = 400

/**
 * Returns the maximum log details panel width (50vw).
 * Falls back to a reasonable default for SSR.
 */
export const getMaxLogDetailsWidth = () =>
  typeof window !== 'undefined' ? window.innerWidth * 0.5 : 800

/**
 * Log details UI state persisted across sessions.
 */
interface LogDetailsUIState {
  panelWidth: number
  setPanelWidth: (width: number) => void
  isResizing: boolean
  setIsResizing: (isResizing: boolean) => void
}

export const useLogDetailsUIStore = create<LogDetailsUIState>()(
  persist(
    (set) => ({
      panelWidth: DEFAULT_LOG_DETAILS_WIDTH,
      /**
       * Updates the log details panel width, enforcing min/max constraints.
       * @param width - Desired width in pixels for the panel.
       */
      setPanelWidth: (width) => {
        const maxWidth = getMaxLogDetailsWidth()
        const clampedWidth = Math.max(MIN_LOG_DETAILS_WIDTH, Math.min(width, maxWidth))
        set({ panelWidth: clampedWidth })
      },
      isResizing: false,
      /**
       * Updates the resize state flag.
       * @param isResizing - True while the panel is being resized via mouse drag.
       */
      setIsResizing: (isResizing) => {
        set({ isResizing })
      },
    }),
    {
      name: 'log-details-ui-state',
    }
  )
)
