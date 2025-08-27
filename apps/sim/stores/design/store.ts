import { create } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'

interface DesignStore {
  // State
  selectedBlockId: string | null
  isOpen: boolean
  designWidth: number

  // Actions
  selectBlock: (blockId: string | null) => void
  toggleDesign: () => void
  setDesignWidth: (width: number) => void
  closeDesign: () => void
}

const DEFAULT_DESIGN_WIDTH = 308
const MIN_DESIGN_WIDTH = 308
const MAX_DESIGN_WIDTH = 600

export const useDesignStore = create<DesignStore>()(
  devtools(
    subscribeWithSelector((set) => ({
      // Initial state
      selectedBlockId: null,
      isOpen: false,
      designWidth: DEFAULT_DESIGN_WIDTH,

      // Actions
      selectBlock: (blockId) =>
        set((state) => ({
          selectedBlockId: blockId,
          isOpen: blockId !== null,
        })),

      toggleDesign: () =>
        set((state) => ({
          isOpen: !state.isOpen,
        })),

      setDesignWidth: (width) =>
        set(() => ({
          designWidth: Math.max(MIN_DESIGN_WIDTH, Math.min(MAX_DESIGN_WIDTH, width)),
        })),

      closeDesign: () =>
        set(() => ({
          isOpen: false,
        })),
    })),
    {
      name: 'design-store',
    }
  )
)
