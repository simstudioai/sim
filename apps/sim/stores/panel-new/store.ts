import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PanelState, PanelTab } from './types'

/**
 * Panel width constraints
 */
const MIN_PANEL_WIDTH = 244
const MAX_PANEL_WIDTH = 400

/**
 * Default panel tab
 */
const DEFAULT_TAB: PanelTab = 'copilot'

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      panelWidth: MIN_PANEL_WIDTH,
      setPanelWidth: (width) => {
        const clampedWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width))
        set({ panelWidth: clampedWidth })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--panel-width', `${clampedWidth}px`)
        }
      },
      activeTab: DEFAULT_TAB,
      setActiveTab: (tab) => {
        set({ activeTab: tab })
        // Remove data attribute once React takes control
        if (typeof document !== 'undefined') {
          document.documentElement.removeAttribute('data-panel-active-tab')
        }
      },
      previousTab: null,
      setPreviousTab: (tab) => {
        set({ previousTab: tab })
      },
      _hasHydrated: false,
      setHasHydrated: (hasHydrated) => {
        set({ _hasHydrated: hasHydrated })
      },
    }),
    {
      name: 'panel-state',
      onRehydrateStorage: () => (state) => {
        // Sync CSS variables with stored state after rehydration
        if (state && typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--panel-width', `${state.panelWidth}px`)
          // Remove the data attribute so CSS rules stop interfering
          document.documentElement.removeAttribute('data-panel-active-tab')
        }
      },
    }
  )
)
