'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  WorkflowSearchRange,
  WorkflowSearchTarget,
  WorkflowSearchValuePath,
} from '@/lib/workflows/search-replace/types'
import { EDITOR_CONNECTIONS_HEIGHT } from '@/stores/constants'
import { usePanelStore } from '../store'

let renameCallback: (() => void) | null = null

export type ActiveSearchTargetKind = WorkflowSearchTarget['kind']

export interface ActiveSearchTarget {
  matchId: string
  blockId: string
  subBlockId: string
  canonicalSubBlockId: string
  valuePath: WorkflowSearchValuePath
  kind: string
  targetKind: ActiveSearchTargetKind
  subBlockType: string
  rawValue: string
  searchText: string
  query: string
  range?: WorkflowSearchRange
  structuredOccurrenceIndex?: number
  displayLabel?: string
  resourceGroupKey?: string
}

/**
 * State for the Editor panel.
 * Tracks the currently selected block to edit its subblocks/values and connections panel height.
 */
interface PanelEditorState {
  /** Currently selected block identifier, or null when nothing is selected */
  currentBlockId: string | null
  /** Sets the current selected block identifier (use null to clear) */
  setCurrentBlockId: (blockId: string | null) => void
  /**
   * Clears the current selection.
   *
   * Leaves {@link PanelEditorSearchState.activeSearchTarget} alone: the search
   * panel owns that target's lifetime, and deselecting a block is not the end
   * of a search. Clearing it here made a Note match impossible to render — the
   * editor answers a Note by deselecting it, which destroyed the very target
   * the Note card was about to paint.
   */
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

interface PanelEditorSearchState {
  /**
   * Ephemeral workflow search target used for scrolling/highlighting editor fields.
   *
   * Re-published with a fresh object identity on most of the search panel's own
   * renders — its match-hydration hooks hand back new arrays, so the effect that
   * publishes this re-runs constantly with an equal target. Subscribe to the
   * fields you need as primitives (or under `useShallow`), never to the object.
   * Any component that both holds the object and can re-render the search panel
   * closes an unbounded update loop the moment a search opens.
   */
  activeSearchTarget: ActiveSearchTarget | null
  /** Sets an active search target to highlight in the editor */
  setActiveSearchTarget: (target: ActiveSearchTarget | null) => void
}

export const usePanelEditorSearchStore = create<PanelEditorSearchState>()((set) => ({
  activeSearchTarget: null,
  setActiveSearchTarget: (target) => {
    set({ activeSearchTarget: target })
    if (target) {
      usePanelStore.getState().setActiveTab('editor')
    }
  },
}))

/**
 * Editor panel store.
 * Persisted to preserve selection across navigations/refreshes.
 */
export const usePanelEditorStore = create<PanelEditorState>()(
  persist(
    (set, get) => ({
      currentBlockId: null,
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
          usePanelStore.getState().setActiveTab('editor')
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
