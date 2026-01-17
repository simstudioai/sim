import { cn } from '@/lib/core/utils/cn'

export type BlockDiffStatus = 'new' | 'edited' | null | undefined

export type BlockRunPathStatus = 'success' | 'error' | undefined

export interface BlockRingOptions {
  /** Whether the block is executing (shows green pulsing ring) */
  isExecuting: boolean
  /** Whether the editor panel is open for this block (shows blue ring) */
  isEditorOpen: boolean
  isPending: boolean
  isDeletedBlock: boolean
  diffStatus: BlockDiffStatus
  runPathStatus: BlockRunPathStatus
  isPreviewSelection?: boolean
  /** Whether the block is selected via shift-click or selection box (shows blue ring) */
  isSelected?: boolean
}

/**
 * Derives visual ring visibility and class names for workflow blocks
 * based on editor open state, execution, diff, deletion, and run-path states.
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
    runPathStatus,
    isPreviewSelection,
    isSelected,
  } = options

  const hasRing =
    isExecuting ||
    isEditorOpen ||
    isSelected ||
    isPending ||
    diffStatus === 'new' ||
    diffStatus === 'edited' ||
    isDeletedBlock ||
    !!runPathStatus

  const ringClassName = cn(
    // Executing block: pulsing success ring with prominent thickness (highest priority)
    isExecuting && 'ring-[3.5px] ring-[var(--border-success)] animate-ring-pulse',
    // Editor open, selected, or preview selection: static blue ring
    !isExecuting &&
      (isEditorOpen || isSelected || isPreviewSelection) &&
      'ring-[1.75px] ring-[var(--brand-secondary)]',
    // Non-active states use standard ring utilities
    !isExecuting &&
      !isEditorOpen &&
      !isSelected &&
      !isPreviewSelection &&
      hasRing &&
      'ring-[1.75px]',
    // Pending state: warning ring
    !isExecuting && !isEditorOpen && !isSelected && isPending && 'ring-[var(--warning)]',
    // Deleted state (highest priority after active/pending)
    !isExecuting &&
      !isEditorOpen &&
      !isSelected &&
      !isPending &&
      isDeletedBlock &&
      'ring-[var(--text-error)]',
    // Diff states
    !isExecuting &&
      !isEditorOpen &&
      !isSelected &&
      !isPending &&
      !isDeletedBlock &&
      diffStatus === 'new' &&
      'ring-[var(--brand-tertiary-2)]',
    !isExecuting &&
      !isEditorOpen &&
      !isSelected &&
      !isPending &&
      !isDeletedBlock &&
      diffStatus === 'edited' &&
      'ring-[var(--warning)]',
    // Run path states (lowest priority - only show if no other states active)
    !isExecuting &&
      !isEditorOpen &&
      !isSelected &&
      !isPending &&
      !isDeletedBlock &&
      !diffStatus &&
      runPathStatus === 'success' &&
      'ring-[var(--border-success)]',
    !isExecuting &&
      !isEditorOpen &&
      !isSelected &&
      !isPending &&
      !isDeletedBlock &&
      !diffStatus &&
      runPathStatus === 'error' &&
      'ring-[var(--text-error)]'
  )

  return { hasRing, ringClassName }
}
