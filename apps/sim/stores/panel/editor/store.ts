'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EDITOR_CONNECTIONS_HEIGHT } from '@/stores/constants'

let renameCallback: (() => void) | null = null

/**
 * Asks the workflow panel to switch to the editor tab. The active tab lives
 * in the URL via nuqs, which is React-only, so we hop through a window event
 * that the panel component listens for.
 */
function requestEditorTab() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('panel:set-tab', { detail: 'editor' }))
}

export interface ActiveSearchTarget {
  matchId: string
  blockId: string
  subBlockId: string
  canonicalSubBlockId: string
  valuePath: Array<string | number>
  kind: string
  resourceGroupKey?: string
}

/**
 * State for the Editor panel.
 * Tracks the currently selected block to edit its subblocks/values and connections panel height.
 */
interface PanelEditorState {
  /** Currently selected block identifier, or null when nothing is selected */
  currentBlockId: string | null
  /** Ephemeral workflow search target used for scrolling/highlighting editor fields */
  activeSearchTarget: ActiveSearchTarget | null
  /** Sets the current selected block identifier (use null to clear) */
  setCurrentBlockId: (blockId: string | null) => void
  /** Sets an active search target to highlight in the editor */
  setActiveSearchTarget: (target: ActiveSearchTarget | null) => void
  /** Clears the current selection */
  clearCurrentBlock: () => void
  /** Height of the connections section in pixels */
  connectionsHeight: number
  /** Sets the connections section height */
  setConnectionsHeight: (height: number) => void
  /** Toggle connections between collapsed (min height) and expanded (default height) */
  toggleConnectionsCollapsed: () => void
  /** Register the rename callback (called by Editor on mount) */
  registerRenameCallback: (callback: (() => void) | null) => void
  /** Trigger rename mode by invoking the registered callback */
  triggerRename: () => void
}

/**
 * Editor panel store.
 * Persisted to preserve selection across navigations/refreshes.
 */
export const usePanelEditorStore = create<PanelEditorState>()(
  persist(
    (set, get) => ({
      currentBlockId: null,
      activeSearchTarget: null,
      connectionsHeight: EDITOR_CONNECTIONS_HEIGHT.DEFAULT,
      registerRenameCallback: (callback) => {
        renameCallback = callback
      },
      triggerRename: () => {
        renameCallback?.()
      },
      setCurrentBlockId: (blockId) => {
        set({ currentBlockId: blockId })
        if (blockId !== null) {
          requestEditorTab()
        }
      },
      setActiveSearchTarget: (target) => {
        set({ activeSearchTarget: target })
        if (target) {
          requestEditorTab()
        }
      },
      clearCurrentBlock: () => {
        set({ currentBlockId: null, activeSearchTarget: null })
      },
      setConnectionsHeight: (height) => {
        const clampedHeight = Math.max(
          EDITOR_CONNECTIONS_HEIGHT.MIN,
          Math.min(EDITOR_CONNECTIONS_HEIGHT.MAX, height)
        )
        set({ connectionsHeight: clampedHeight })
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
