import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Toolbar triggers height constraints
 * Minimum is set low to allow collapsing to just the header height (~30-40px)
 */
const DEFAULT_TOOLBAR_TRIGGERS_HEIGHT = 300
const MIN_TOOLBAR_HEIGHT = 30
const MAX_TOOLBAR_HEIGHT = 800

/**
 * Toolbar state interface
 */
interface ToolbarState {
  toolbarTriggersHeight: number
  setToolbarTriggersHeight: (height: number) => void
  preSearchHeight: number | null
  setPreSearchHeight: (height: number | null) => void
}

export const useToolbarStore = create<ToolbarState>()(
  persist(
    (set) => ({
      toolbarTriggersHeight: DEFAULT_TOOLBAR_TRIGGERS_HEIGHT,
      setToolbarTriggersHeight: (height) => {
        const clampedHeight = Math.max(MIN_TOOLBAR_HEIGHT, Math.min(MAX_TOOLBAR_HEIGHT, height))
        set({ toolbarTriggersHeight: clampedHeight })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty(
            '--toolbar-triggers-height',
            `${clampedHeight}px`
          )
        }
      },
      preSearchHeight: null,
      setPreSearchHeight: (height) => set({ preSearchHeight: height }),
    }),
    {
      name: 'toolbar-state',
      onRehydrateStorage: () => (state) => {
        // Sync CSS variables with stored state after rehydration
        if (state && typeof window !== 'undefined') {
          document.documentElement.style.setProperty(
            '--toolbar-triggers-height',
            `${state.toolbarTriggersHeight || DEFAULT_TOOLBAR_TRIGGERS_HEIGHT}px`
          )
        }
      },
    }
  )
)
