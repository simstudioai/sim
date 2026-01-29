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
}

/**
 * Represents a tool operation item in the search results.
 */
export interface SearchToolOperationItem {
  id: string
  name: string
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
 * Global state for the universal search modal.
 *
 * Centralizing this state in a store allows any component (e.g. sidebar,
 * workflow command list, keyboard shortcuts) to open or close the modal
 * without relying on DOM events or prop drilling.
 */
export interface SearchModalState {
  /** Whether the search modal is currently open. */
  isOpen: boolean

  /** Pre-computed search data. */
  data: SearchData

  /**
   * Explicitly set the open state of the modal.
   */
  setOpen: (open: boolean) => void

  /**
   * Convenience method to open the modal.
   */
  open: () => void

  /**
   * Convenience method to close the modal.
   */
  close: () => void

  /**
   * Initialize search data. Called once on app load.
   */
  initializeData: (filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]) => void
}
