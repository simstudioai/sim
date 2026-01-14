import { cn } from '@/lib/core/utils/cn'

export type BlockDiffStatus = 'new' | 'edited' | null | undefined

export type BlockRunPathStatus = 'success' | 'error' | undefined

export interface BlockRingOptions {
  isActive: boolean
  isPending: boolean
  isDeletedBlock: boolean
  diffStatus: BlockDiffStatus
  runPathStatus: BlockRunPathStatus
  isPreviewSelection?: boolean
  isGroupedSelection?: boolean
}

/**
 * Derives visual ring visibility and class names for workflow blocks
 * based on execution, diff, deletion, and run-path states.
 */
export function getBlockRingStyles(options: BlockRingOptions): {
  hasRing: boolean
  ringClassName: string
} {
  const {
    isActive,
    isPending,
    isDeletedBlock,
    diffStatus,
    runPathStatus,
    isPreviewSelection,
    isGroupedSelection,
  } = options

  const hasRing =
    isActive ||
    isPending ||
    diffStatus === 'new' ||
    diffStatus === 'edited' ||
    isDeletedBlock ||
    !!runPathStatus ||
    !!isGroupedSelection

  const ringClassName = cn(
    // Grouped selection: more transparent ring for blocks selected as part of a group
    // Using rgba with the brand-secondary color (#33b4ff) at 40% opacity
    isGroupedSelection &&
      !isActive &&
      'ring-[2px] ring-[rgba(51,180,255,0.4)]',
    // Preview selection: static blue ring (standard thickness, no animation)
    isActive && isPreviewSelection && 'ring-[1.75px] ring-[var(--brand-secondary)]',
    // Executing block: pulsing success ring with prominent thickness
    isActive &&
      !isPreviewSelection &&
      !isGroupedSelection &&
      'ring-[3.5px] ring-[var(--border-success)] animate-ring-pulse',
    // Non-active states use standard ring utilities (except grouped selection which has its own)
    !isActive && hasRing && !isGroupedSelection && 'ring-[1.75px]',
    // Pending state: warning ring
    !isActive && isPending && 'ring-[var(--warning)]',
    // Deleted state (highest priority after active/pending)
    !isActive && !isPending && isDeletedBlock && 'ring-[var(--text-error)]',
    // Diff states
    !isActive &&
      !isPending &&
      !isDeletedBlock &&
      diffStatus === 'new' &&
      'ring-[var(--brand-tertiary-2)]',
    !isActive &&
      !isPending &&
      !isDeletedBlock &&
      diffStatus === 'edited' &&
      'ring-[var(--warning)]',
    // Run path states (lowest priority - only show if no other states active)
    !isActive &&
      !isPending &&
      !isDeletedBlock &&
      !diffStatus &&
      runPathStatus === 'success' &&
      'ring-[var(--border-success)]',
    !isActive &&
      !isPending &&
      !isDeletedBlock &&
      !diffStatus &&
      runPathStatus === 'error' &&
      'ring-[var(--text-error)]'
  )

  return { hasRing, ringClassName }
}
