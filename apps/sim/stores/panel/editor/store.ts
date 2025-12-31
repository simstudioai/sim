'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EDITOR_CONNECTIONS_HEIGHT } from '@/stores/constants'
import { usePanelStore } from '../store'

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
  /** Flag to signal the editor to focus the rename input */
  shouldFocusRename: boolean
  /** Sets the shouldFocusRename flag */
  setShouldFocusRename: (value: boolean) => void
}

/**
 * Editor panel store.
 * Persisted to preserve selection across navigations/refreshes.
 */
export const usePanelEditorStore = create<PanelEditorState>()(
  persist(
    (set, get) => ({
      currentBlockId: null,
      connectionsHeight: EDITOR_CONNECTIONS_HEIGHT.DEFAULT,
      shouldFocusRename: false,
      setShouldFocusRename: (value) => set({ shouldFocusRename: value }),
      setCurrentBlockId: (blockId) => {
        set({ currentBlockId: blockId })

        // When a block is selected, always switch to the editor tab
        if (blockId !== null) {
          const panelState = usePanelStore.getState()
          panelState.setActiveTab('editor')
        }
      },
      clearCurrentBlock: () => {
        set({ currentBlockId: null })
      },
      setConnectionsHeight: (height) => {
        const clampedHeight = Math.max(
          EDITOR_CONNECTIONS_HEIGHT.MIN,
          Math.min(EDITOR_CONNECTIONS_HEIGHT.MAX, height)
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
        const newHeight = isAtMinHeight
          ? EDITOR_CONNECTIONS_HEIGHT.DEFAULT
          : EDITOR_CONNECTIONS_HEIGHT.MIN

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
      partialize: (state) => ({
        currentBlockId: state.currentBlockId,
        connectionsHeight: state.connectionsHeight,
      }),
      onRehydrateStorage: () => (state) => {
        // Sync CSS variables with stored state after rehydration
        if (state && typeof window !== 'undefined') {
          document.documentElement.style.setProperty(
            '--editor-connections-height',
            `${state.connectionsHeight || EDITOR_CONNECTIONS_HEIGHT.DEFAULT}px`
          )
        }
      },
    }
  )
)
