import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { VariablesModalStore } from '@/stores/variables/types'

/**
 * Floating variables modal default dimensions.
 * Slightly larger than the chat modal for more comfortable editing.
 */
const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 320

/**
 * Minimum and maximum modal dimensions.
 */
const MIN_VARIABLES_WIDTH = DEFAULT_WIDTH
const MIN_VARIABLES_HEIGHT = DEFAULT_HEIGHT
const MAX_VARIABLES_WIDTH = 500
const MAX_VARIABLES_HEIGHT = 600

/**
 * UI-only store for the floating variables modal.
 * Variable data lives in the variables data store (`@/stores/variables/store`).
 */
export const useVariablesModalStore = create<VariablesModalStore>()(
  devtools(
    persist(
      (set) => ({
        isOpen: false,
        position: null,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,

        setIsOpen: (open) => set({ isOpen: open }),
        setPosition: (position) => set({ position }),
        setDimensions: (dimensions) =>
          set({
            width: Math.max(MIN_VARIABLES_WIDTH, Math.min(MAX_VARIABLES_WIDTH, dimensions.width)),
            height: Math.max(
              MIN_VARIABLES_HEIGHT,
              Math.min(MAX_VARIABLES_HEIGHT, dimensions.height)
            ),
          }),
        resetPosition: () => set({ position: null }),
      }),
      {
        name: 'variables-modal-store',
        partialize: (state) => ({
          position: state.position,
          width: state.width,
          height: state.height,
        }),
      }
    ),
    { name: 'variables-modal-store' }
  )
)
