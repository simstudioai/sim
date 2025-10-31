'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { usePanelStore } from '../store'

/**
 * State for the Editor panel.
 * Tracks the currently selected block to edit its subblocks/values.
 */
interface PanelEditorState {
  /** Currently selected block identifier, or null when nothing is selected */
  currentBlockId: string | null
  /** Sets the current selected block identifier (use null to clear) */
  setCurrentBlockId: (blockId: string | null) => void
  /** Clears the current selection */
  clearCurrentBlock: () => void
}

/**
 * Editor panel store.
 * Persisted to preserve selection across navigations/refreshes.
 */
export const usePanelEditorStore = create<PanelEditorState>()(
  persist(
    (set) => ({
      currentBlockId: null,
      setCurrentBlockId: (blockId) => {
        set({ currentBlockId: blockId })

        // When a block is selected, switch to editor tab and remember previous tab
        if (blockId !== null) {
          const panelState = usePanelStore.getState()
          const currentTab = panelState.activeTab

          // Only save the previous tab if we're not already on the editor tab
          if (currentTab !== 'editor') {
            panelState.setPreviousTab(currentTab)
            panelState.setActiveTab('editor')
          }
        }
      },
      clearCurrentBlock: () => {
        set({ currentBlockId: null })

        // When selection is cleared, restore the previous tab
        const panelState = usePanelStore.getState()
        const previousTab = panelState.previousTab

        if (previousTab !== null) {
          panelState.setActiveTab(previousTab)
          panelState.setPreviousTab(null)
        }
      },
    }),
    {
      name: 'panel-editor-state',
    }
  )
)
