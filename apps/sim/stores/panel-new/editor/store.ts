'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { usePanelStore } from '../store'

/**
 * Connections height constraints
 */
const DEFAULT_CONNECTIONS_HEIGHT = 115
const MIN_CONNECTIONS_HEIGHT = 30
const MAX_CONNECTIONS_HEIGHT = 300

/**
 * State for the Editor panel.
 * Tracks the currently selected block to edit its subblocks/values and connections panel height.
 */
interface PanelEditorState {
  /** Currently selected block identifier, or null when nothing is selected */
  currentBlockId: string | null
  /** Sets the current selected block identifier (use null to clear) */
  setCurrentBlockId: (blockId: string | null) => void
  /** Clears the current selection */
  clearCurrentBlock: () => void
  /** Height of the connections section in pixels */
  connectionsHeight: number
  /** Sets the connections section height */
  setConnectionsHeight: (height: number) => void
  /** Toggle connections between collapsed (min height) and expanded (default height) */
  toggleConnectionsCollapsed: () => void
}

/**
 * Editor panel store.
 * Persisted to preserve selection across navigations/refreshes.
 */
export const usePanelEditorStore = create<PanelEditorState>()(
  persist(
    (set, get) => ({
      currentBlockId: null,
      connectionsHeight: DEFAULT_CONNECTIONS_HEIGHT,
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
      setConnectionsHeight: (height) => {
        const clampedHeight = Math.max(
          MIN_CONNECTIONS_HEIGHT,
          Math.min(MAX_CONNECTIONS_HEIGHT, height)
        )
        set({ connectionsHeight: clampedHeight })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty(
            '--editor-connections-height',
            `${clampedHeight}px`
          )
        }
      },
      toggleConnectionsCollapsed: () => {
        const currentState = get()
        const isAtMinHeight = currentState.connectionsHeight <= 35
        const newHeight = isAtMinHeight ? DEFAULT_CONNECTIONS_HEIGHT : MIN_CONNECTIONS_HEIGHT

        set({ connectionsHeight: newHeight })

        // Update CSS variable
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty(
            '--editor-connections-height',
            `${newHeight}px`
          )
        }
      },
    }),
    {
      name: 'panel-editor-state',
      onRehydrateStorage: () => (state) => {
        // Sync CSS variables with stored state after rehydration
        if (state && typeof window !== 'undefined') {
          document.documentElement.style.setProperty(
            '--editor-connections-height',
            `${state.connectionsHeight || DEFAULT_CONNECTIONS_HEIGHT}px`
          )
        }
      },
    }
  )
)
