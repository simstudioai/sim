import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LogDetailsUIState } from './types'
import { DEFAULT_LOG_DETAILS_WIDTH, getMaxLogDetailsWidth, MIN_LOG_DETAILS_WIDTH } from './utils'

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
