import { WorkflowBlockContent } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block-content'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface StageBlockCardProps {
  block: BlockDef
}

/**
 * Block card shell for the vertical-flow stage - the hero-visual's faithful
 * {@link WorkflowBlockContent} body with top (incoming) / bottom (outgoing)
 * handle nubs instead of the horizontal-flow left/right ones. Shared by the
 * hero's live workflow stage and the Build feature card's workflow peek.
 */
export function StageBlockCard({ block }: StageBlockCardProps) {
  return (
    <div className='relative rounded-[13px] border border-[var(--border-1)] bg-[var(--surface-2)] shadow-sm'>
      <WorkflowBlockContent block={block} />
      {!block.isTrigger && (
        <span
          aria-hidden
          className='-translate-x-1/2 absolute top-[-7px] left-1/2 h-[7px] w-5 rounded-t-[2px] bg-[var(--workflow-edge)]'
        />
      )}
      {!block.isTerminal && (
        <span
          aria-hidden
          className='-translate-x-1/2 absolute bottom-[-7px] left-1/2 h-[7px] w-5 rounded-b-[2px] bg-[var(--workflow-edge)]'
        />
      )}
    </div>
  )
}
