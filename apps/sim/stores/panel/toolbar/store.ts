import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type ToolbarSectionKey = 'triggers' | 'blocks' | 'customBlocks' | 'tools'

interface ToolbarState {
  expandedSections: Record<ToolbarSectionKey, boolean>
  setSectionExpanded: (key: ToolbarSectionKey, expanded: boolean) => void
}

const initialState: Pick<ToolbarState, 'expandedSections'> = {
  expandedSections: { triggers: true, blocks: true, customBlocks: true, tools: true },
}

export const useToolbarStore = create<ToolbarState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        setSectionExpanded: (key, expanded) =>
          set((state) => ({
            expandedSections: { ...state.expandedSections, [key]: expanded },
          })),
      }),
      {
        name: 'toolbar-state',
        partialize: (state) => ({ expandedSections: state.expandedSections }),
      }
    ),
    { name: 'toolbar-store' }
  )
)
