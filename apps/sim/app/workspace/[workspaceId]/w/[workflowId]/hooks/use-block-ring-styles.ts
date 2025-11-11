import { useMemo } from 'react'
import { cn } from '@/lib/utils'

interface UseBlockRingStylesOptions {
  isActive: boolean
  isFocused: boolean
  isPending?: boolean
  diffStatus?: 'new' | 'edited' | null
  isDeletedBlock: boolean
}

/**
 * Shared hook for computing ring styles across block types.
 * Handles visual states: active, pending, focused, diff status, deleted.
 */
export function useBlockRingStyles({
  isActive,
  isFocused,
  isPending = false,
  diffStatus,
  isDeletedBlock,
}: UseBlockRingStylesOptions) {
  return useMemo(() => {
    const hasRing =
      isActive ||
      isPending ||
      isFocused ||
      diffStatus === 'new' ||
      diffStatus === 'edited' ||
      isDeletedBlock

    const ringStyles = cn(
      hasRing && 'ring-[1.75px]',
      isActive && 'ring-[#8C10FF] animate-pulse-ring',
      isPending && 'ring-[#FF6600]',
      isFocused && 'ring-[#33B4FF]',
      diffStatus === 'new' && 'ring-[#22C55F]',
      diffStatus === 'edited' && 'ring-[#FF6600]',
      isDeletedBlock && 'ring-[#EF4444]'
    )

    return { hasRing, ringStyles }
  }, [isActive, isPending, isFocused, diffStatus, isDeletedBlock])
}
