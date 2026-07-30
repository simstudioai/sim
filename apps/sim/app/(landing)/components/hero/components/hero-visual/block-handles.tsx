import { cn } from '@sim/emcn'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface BlockHandlesProps {
  block: BlockDef
  handlesVisible?: boolean
}

/**
 * The decorative edge-handle nubs for a block - an inbound nub on the left
 * unless the block is a trigger, an outbound nub on the right unless it's
 * terminal. Absolutely positioned, so the caller must be a `relative` (or
 * otherwise positioned) box of the block's width. Shared so the morphed chat
 * card (GitHub, rendered as content-only) can carry the same handles as the
 * real {@link WorkflowBlock} satellites.
 */
export function BlockHandles({ block, handlesVisible = true }: BlockHandlesProps) {
  return (
    <>
      {!block.isTrigger && (
        <span
          aria-hidden
          className={cn(
            '-translate-y-1/2 absolute top-5 left-[-7px] h-5 w-[7px] rounded-l-[2px] bg-[var(--workflow-edge)] transition-opacity duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            handlesVisible ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
      {!block.isTerminal && (
        <span
          aria-hidden
          className={cn(
            '-translate-y-1/2 absolute top-5 right-[-7px] h-5 w-[7px] rounded-r-[2px] bg-[var(--workflow-edge)] transition-opacity duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            handlesVisible ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
    </>
  )
}
