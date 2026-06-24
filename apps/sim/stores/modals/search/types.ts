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
  /** Integration category slug ({@link IntegrationType}), set for tools only. */
  integrationType?: string
}

/** Which add-block list a {@link SearchCategory} drills into. */
export type SearchCategoryKind = 'block' | 'trigger' | 'tool'

/**
 * A browsable group shown in the palette's empty state. Selecting one scopes
 * the list to just that category's blocks instead of dumping the full catalog.
 */
export interface SearchCategory {
  /** `'blocks'`, `'triggers'`, or an {@link IntegrationType} slug. */
  id: string
  /** Human-readable heading (e.g. "Core Blocks", "Communication"). */
  label: string
  kind: SearchCategoryKind
  /** Number of blocks in this category. */
  count: number
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
  /** Browsable categories for the empty-state drill-down. */
  categories: SearchCategory[]
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
