import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PANEL_WIDTH } from '@/stores/constants'
import type { PanelState, PanelTab } from '@/stores/panel/types'

/**
 * Default panel tab
 */
const DEFAULT_TAB: PanelTab = 'toolbar'

/**
 * Set of valid panel tabs used to sanitize persisted state from older
 * versions (e.g. a persisted 'copilot' tab that no longer exists)
 */
const VALID_TABS: ReadonlySet<string> = new Set<PanelTab>(['editor', 'toolbar'])

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
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as Partial<PanelState>
        if (typeof state?.activeTab !== 'string' || !VALID_TABS.has(state.activeTab)) {
          return { ...state, activeTab: DEFAULT_TAB }
        }
        return state
      },
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
