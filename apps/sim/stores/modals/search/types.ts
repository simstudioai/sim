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
 * Context handed to the palette when it is opened to complete an edge
 * drag-release: the dragged source handle and the release point. A selection
 * stamps it onto its event so the canvas places the block at the drop point and
 * wires it from that handle.
 */
export interface PendingConnect {
  source: { nodeId: string; handleId: string }
  screenX: number
  screenY: number
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

  /**
   * When set, the palette renders only these sections; `null` shows all of them.
   */
  sections: SearchSection[] | null

  /**
   * Pending edge drag-release the palette was opened to complete. A selection
   * stamps it onto its event; other add-block dispatchers carry none, so only a
   * genuine palette pick completes the connection. `null` for ordinary opens.
   */
  pendingConnect: PendingConnect | null

  /** Pre-computed search data. */
  data: SearchData

  /**
   * Explicitly set the open state of the modal. Always resets to the full
   * palette (no section restriction, no pending connect).
   */
  setOpen: (open: boolean) => void

  /**
   * Convenience method to open the modal. Pass `sections` to restrict the
   * palette to a subset of result groups, and `pendingConnect` to complete an
   * edge drag-release with the selection.
   */
  open: (options?: { sections?: SearchSection[]; pendingConnect?: PendingConnect }) => void

  /**
   * Convenience method to close the modal.
   */
  close: () => void

  /**
   * Initialize search data. Called once on app load.
   */
  initializeData: (filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]) => void
}
