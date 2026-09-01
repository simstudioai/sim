import type { ComponentType } from 'react'
import type { IsToolAllowed } from '@/lib/permission-groups/operation-access'
import type { BlockConfig } from '@/blocks/types'

/**
 * Represents a block item in the search results.
 */
export interface SearchBlockItem {
  id: string
  name: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
  type: string
  config?: BlockConfig
  searchValue?: string
  /** Custom blocks only: bound source workflow id — hidden on that workflow's canvas. */
  sourceWorkflowId?: string
}

/**
 * Represents a tool operation item in the search results.
 */
export interface SearchToolOperationItem {
  id: string
  name: string
  serviceName: string
  searchValue: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
  blockType: string
  operationId: string
}

/**
 * Pre-computed search data that is initialized on app load.
 */
export interface SearchData {
  blocks: SearchBlockItem[]
  tools: SearchBlockItem[]
  triggers: SearchBlockItem[]
  toolOperations: SearchToolOperationItem[]
  isInitialized: boolean
}

/**
 * Context handed to the palette when it is opened to complete an edge
 * drag-release: the dragged source handle and the release point. A selection
 * stamps it onto its event so the canvas places the block at the drop point and
 * wires it from that handle.
 */
export interface PendingConnect {
  source: { nodeId: string; handleId: string }
  /** Canvas-space point where the connection was released. */
  position: { x: number; y: number }
}

/**
 * Global state for the universal search modal.
 *
 * Centralizing this state in a store allows any component (e.g. sidebar,
 * workflow command list, keyboard shortcuts) to open or close the modal
 * without relying on DOM events or prop drilling. The pre-computed block data
 * also feeds the canvas connection block selector.
 */
export interface SearchModalState {
  /** Whether the search modal is currently open. */
  isOpen: boolean

  /** Pre-computed block/tool search data (consumed by the canvas selector). */
  data: SearchData

  /** Explicitly set the open state of the modal. */
  setOpen: (open: boolean) => void

  /** Convenience method to open the modal. */
  open: () => void

  /** Convenience method to close the modal. */
  close: () => void

  /**
   * Initialize search data. Re-runs whenever the caller's permission config
   * resolves or changes, since both predicates are derived from it.
   */
  initializeData: (
    filterBlocks: <T extends { type: string }>(blocks: T[]) => T[],
    isToolAllowed: IsToolAllowed
  ) => void
}
