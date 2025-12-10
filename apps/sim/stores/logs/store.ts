import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Width constraints for the log details panel.
 */
export const MIN_LOG_DETAILS_WIDTH = 340
export const MAX_LOG_DETAILS_WIDTH = 700
export const DEFAULT_LOG_DETAILS_WIDTH = 340

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
        const clampedWidth = Math.max(MIN_LOG_DETAILS_WIDTH, Math.min(width, MAX_LOG_DETAILS_WIDTH))
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
