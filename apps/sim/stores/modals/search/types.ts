import type { ComponentType } from 'react'
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
 * Represents a doc item in the search results.
 */
export interface SearchDocItem {
  id: string
  name: string
  icon: ComponentType<{ className?: string }>
  href: string
}

/**
 * Pre-computed search data that is initialized on app load.
 */
export interface SearchData {
  blocks: SearchBlockItem[]
  tools: SearchBlockItem[]
  triggers: SearchBlockItem[]
  toolOperations: SearchToolOperationItem[]
  docs: SearchDocItem[]
  isInitialized: boolean
}

/**
 * Context handed to the connection block selector when it opens to complete an
 * edge drag-release: the dragged source handle and the release point.
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
   * Initialize search data. Called once on app load.
   */
  initializeData: (filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]) => void
}
