import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TOOLBAR_TRIGGERS_HEIGHT } from '@/stores/constants'

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
      toolbarTriggersHeight: TOOLBAR_TRIGGERS_HEIGHT.DEFAULT,
      setToolbarTriggersHeight: (height) => {
        const clampedHeight = Math.max(
          TOOLBAR_TRIGGERS_HEIGHT.MIN,
          Math.min(TOOLBAR_TRIGGERS_HEIGHT.MAX, height)
        )
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
            `${state.toolbarTriggersHeight || TOOLBAR_TRIGGERS_HEIGHT.DEFAULT}px`
          )
        }
      },
    }
  )
)
