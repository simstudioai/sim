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
 * Every result group the search modal can render, in render order. Used to
 * restrict the palette to a subset of sections when opened for a specific
 * intent (e.g. a drag-release that should only offer canvas-insertable items).
 */
export const SEARCH_SECTIONS = [
  'actions',
  'connectedAccounts',
  'integrations',
  'blocks',
  'tools',
  'triggers',
  'chats',
  'workflows',
  'tables',
  'files',
  'knowledgeBases',
  'toolOperations',
  'workspaces',
  'docs',
  'pages',
] as const

/** A single search-modal result group. */
export type SearchSection = (typeof SEARCH_SECTIONS)[number]

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

  /**
   * When set, the palette renders only these sections; `null` shows all of them.
   */
  sections: SearchSection[] | null

  /** Pre-computed search data. */
  data: SearchData

  /**
   * Explicitly set the open state of the modal. Always resets to the full
   * palette (no section restriction).
   */
  setOpen: (open: boolean) => void

  /**
   * Convenience method to open the modal. Pass `sections` to restrict the
   * palette to a subset of result groups.
   */
  open: (options?: { sections?: SearchSection[] }) => void

  /**
   * Convenience method to close the modal.
   */
  close: () => void

  /**
   * Initialize search data. Called once on app load.
   */
  initializeData: (filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]) => void
}
