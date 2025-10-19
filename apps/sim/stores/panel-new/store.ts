import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Panel state interface
 */
interface PanelState {
  panelWidth: number
  setPanelWidth: (width: number) => void
}

/**
 * Panel width constraints
 */
const DEFAULT_PANEL_WIDTH = 232
const MIN_PANEL_WIDTH = 232
const MAX_PANEL_WIDTH = 400

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      panelWidth: DEFAULT_PANEL_WIDTH,
      setPanelWidth: (width) => {
        const clampedWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width))
        set({ panelWidth: clampedWidth })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--panel-width', `${clampedWidth}px`)
        }
      },
    }),
    {
      name: 'panel-state',
      onRehydrateStorage: () => (state) => {
        // Sync CSS variables with stored state after rehydration
        if (state && typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--panel-width', `${state.panelWidth}px`)
        }
      },
    }
  )
)
