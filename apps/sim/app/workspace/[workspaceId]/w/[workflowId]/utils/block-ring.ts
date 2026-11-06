import { cn } from '@sim/emcn'

export type BlockDiffStatus = 'new' | 'edited' | null | undefined

interface BlockRingOptions {
  /** Whether the block is executing (suppresses stale status rings) */
  isExecuting: boolean
  /** Whether the editor panel is open for this block (shows blue ring) */
  isEditorOpen: boolean
  isPending: boolean
  isDeletedBlock: boolean
  diffStatus: BlockDiffStatus
  isPreviewSelection?: boolean
  /** Whether the block is selected via shift-click or selection box (shows blue ring) */
  isSelected?: boolean
}

/**
 * Derives visual ring visibility and class names for workflow blocks
 * based on editor open state, execution, diff, deletion, and pending states.
 */
export function getBlockRingStyles(options: BlockRingOptions): {
  hasRing: boolean
  ringClassName: string
} {
  const {
    isExecuting,
    isEditorOpen,
    isPending,
    isDeletedBlock,
    diffStatus,
    isPreviewSelection,
    isSelected,
  } = options

  const isSelectionHighlighted = isEditorOpen || isSelected || isPreviewSelection
  const hasStatusRing =
    !isExecuting && (isPending || diffStatus === 'new' || diffStatus === 'edited' || isDeletedBlock)
  const hasRing = Boolean(isSelectionHighlighted || hasStatusRing)

  const ringClassName = cn(
    // Editor open, selected, or preview selection: neutral highlight ring,
    // matching the selection-highlighted edge color
    isSelectionHighlighted && 'ring-[1.5px] ring-[var(--text-secondary)]',
    // Non-active states use standard ring utilities
    !isSelectionHighlighted && hasStatusRing && 'ring-[1.5px]',
    // Pending state: warning ring
    !isSelectionHighlighted && !isExecuting && isPending && 'ring-[var(--warning)]',
    // Deleted state (highest priority after active/pending)
    !isSelectionHighlighted &&
      !isExecuting &&
      !isPending &&
      isDeletedBlock &&
      'ring-[var(--text-error)]',
    // Diff states
    !isSelectionHighlighted &&
      !isExecuting &&
      !isPending &&
      !isDeletedBlock &&
      diffStatus === 'new' &&
      'ring-[var(--brand-accent)]',
    !isSelectionHighlighted &&
      !isExecuting &&
      !isPending &&
      !isDeletedBlock &&
      diffStatus === 'edited' &&
      'ring-[var(--warning)]'
  )

  return { hasRing, ringClassName }
}
