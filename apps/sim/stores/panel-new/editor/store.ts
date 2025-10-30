'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
      setCurrentBlockId: (blockId) => set({ currentBlockId: blockId }),
      clearCurrentBlock: () => set({ currentBlockId: null }),
    }),
    {
      name: 'panel-editor-state',
    }
  )
)
