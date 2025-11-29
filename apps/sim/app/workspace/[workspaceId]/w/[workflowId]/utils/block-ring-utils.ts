import { cn } from '@/lib/utils'

export type BlockDiffStatus = 'new' | 'edited' | null | undefined

export type BlockRunPathStatus = 'success' | 'error' | undefined

export interface BlockRingOptions {
  isActive: boolean
  isPending: boolean
  isFocused: boolean
  isDeletedBlock: boolean
  diffStatus: BlockDiffStatus
  runPathStatus: BlockRunPathStatus
}

/**
 * Derives visual ring visibility and class names for workflow blocks
 * based on execution, focus, diff, deletion, and run-path states.
 */
export function getBlockRingStyles(options: BlockRingOptions): {
  hasRing: boolean
  ringClassName: string
} {
  const { isActive, isPending, isFocused, isDeletedBlock, diffStatus, runPathStatus } = options

  const hasRing =
    isActive ||
    isPending ||
    isFocused ||
    diffStatus === 'new' ||
    diffStatus === 'edited' ||
    isDeletedBlock ||
    !!runPathStatus

  const ringClassName = cn(
    // Executing block: pulsing success ring with prominent thickness
    isActive && 'ring-[3.5px] ring-[var(--border-success)] animate-ring-pulse',
    // Non-active states use standard ring utilities
    !isActive && hasRing && 'ring-[1.75px]',
    // Pending state: warning ring
    !isActive && isPending && 'ring-[var(--warning)]',
    // Focused (selected) state: brand ring
    !isActive && !isPending && isFocused && 'ring-[var(--brand-secondary)]',
    // Deleted state (highest priority after active/pending/focused)
    !isActive && !isPending && !isFocused && isDeletedBlock && 'ring-[var(--text-error)]',
    // Diff states
    !isActive &&
      !isPending &&
      !isFocused &&
      !isDeletedBlock &&
      diffStatus === 'new' &&
      'ring-[#22C55E]',
    !isActive &&
      !isPending &&
      !isFocused &&
      !isDeletedBlock &&
      diffStatus === 'edited' &&
      'ring-[var(--warning)]',
    // Run path states (lowest priority - only show if no other states active)
    !isActive &&
      !isPending &&
      !isFocused &&
      !isDeletedBlock &&
      !diffStatus &&
      runPathStatus === 'success' &&
      'ring-[var(--border-success)]',
    !isActive &&
      !isPending &&
      !isFocused &&
      !isDeletedBlock &&
      !diffStatus &&
      runPathStatus === 'error' &&
      'ring-[var(--text-error)]'
  )

  return { hasRing, ringClassName }
}
