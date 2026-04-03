import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PANEL_WIDTH } from '@/stores/constants'
import type { PanelState, PanelTab } from '@/stores/panel/types'

/**
 * Default panel tab
 */
const DEFAULT_TAB: PanelTab = 'copilot'

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      panelWidth: PANEL_WIDTH.DEFAULT,
      setPanelWidth: (width) => {
        // Only enforce minimum - maximum is enforced dynamically by the resize hook
        const clampedWidth = Math.max(PANEL_WIDTH.MIN, width)
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
      isResizing: false,
      setIsResizing: (isResizing) => {
        set({ isResizing })
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
