import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Sidebar state interface
 */
interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  triggersHeight: number
  blocksHeight: number
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
  setTriggersHeight: (height: number) => void
  setBlocksHeight: (height: number) => void
}

/**
 * Sidebar width constraints
 */
const DEFAULT_SIDEBAR_WIDTH = 232
const MIN_SIDEBAR_WIDTH = 232
const MAX_SIDEBAR_WIDTH = 400

/**
 * Triggers and Blocks height constraints
 */
const DEFAULT_TRIGGERS_HEIGHT = 200
const DEFAULT_BLOCKS_HEIGHT = 200
const MIN_HEIGHT = 28
const MAX_HEIGHT = 500
const HEADER_HEIGHT = 28

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      workspaceDropdownOpen: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      triggersHeight: DEFAULT_TRIGGERS_HEIGHT,
      blocksHeight: DEFAULT_BLOCKS_HEIGHT,
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      setSidebarWidth: (width) => {
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width))
        set({ sidebarWidth: clampedWidth })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--sidebar-width', `${clampedWidth}px`)
        }
      },
      setTriggersHeight: (height) => {
        const currentBlocksHeight = get().blocksHeight
        // Enforce constraint: triggersHeight >= blocksHeight + HEADER_HEIGHT
        const minAllowedHeight = currentBlocksHeight + HEADER_HEIGHT
        const clampedHeight = Math.max(minAllowedHeight, MIN_HEIGHT, Math.min(MAX_HEIGHT, height))
        set({ triggersHeight: clampedHeight })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--triggers-height', `${clampedHeight}px`)
        }
      },
      setBlocksHeight: (height) => {
        const currentTriggersHeight = get().triggersHeight
        // Enforce constraint: blocksHeight <= triggersHeight - HEADER_HEIGHT
        const maxAllowedHeight = currentTriggersHeight - HEADER_HEIGHT
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(maxAllowedHeight, MAX_HEIGHT, height))
        set({ blocksHeight: clampedHeight })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--blocks-height', `${clampedHeight}px`)
        }
      },
    }),
    {
      name: 'sidebar-state',
      onRehydrateStorage: () => (state) => {
        // Validate and enforce constraints after rehydration
        if (state && typeof window !== 'undefined') {
          // Enforce constraint: triggersHeight >= blocksHeight + HEADER_HEIGHT
          let { triggersHeight, blocksHeight } = state
          const minTriggersHeight = blocksHeight + HEADER_HEIGHT

          if (triggersHeight < minTriggersHeight) {
            triggersHeight = Math.max(minTriggersHeight, DEFAULT_TRIGGERS_HEIGHT)
            state.triggersHeight = triggersHeight
          }

          // Enforce constraint: blocksHeight <= triggersHeight - HEADER_HEIGHT
          const maxBlocksHeight = triggersHeight - HEADER_HEIGHT
          if (blocksHeight > maxBlocksHeight) {
            blocksHeight = Math.max(MIN_HEIGHT, Math.min(maxBlocksHeight, DEFAULT_BLOCKS_HEIGHT))
            state.blocksHeight = blocksHeight
          }

          // Sync CSS variables with validated state
          document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`)
          document.documentElement.style.setProperty('--triggers-height', `${triggersHeight}px`)
          document.documentElement.style.setProperty('--blocks-height', `${blocksHeight}px`)
        }
      },
    }
  )
)
