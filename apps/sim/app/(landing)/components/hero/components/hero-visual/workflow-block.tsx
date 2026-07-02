import { cn } from '@sim/emcn'
import { BlockHandles } from '@/app/(landing)/components/hero/components/hero-visual/block-handles'
import { WorkflowBlockContent } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block-content'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface WorkflowBlockProps {
  block: BlockDef
  contentVisible?: boolean
  handlesVisible?: boolean
}

/**
 * A pure presentational workflow block card, faithful to the real WorkflowBlock:
 * a fixed-width card with an icon-tile header and optional label → value rows,
 * plus decorative handle nubs on its left and right edges. Stateless and
 * client-free - positioning and the rise animation are owned by the parent stage.
 * `contentVisible`/`handlesVisible` crossfade the content and handles so a block
 * can soften into a shell (used when the Jira block morphs into the KB panel).
 */
export function WorkflowBlock({
  block,
  contentVisible = true,
  handlesVisible = true,
}: WorkflowBlockProps) {
  return (
    <div className='relative w-[250px] rounded-[13px] border border-[var(--border-1)] bg-[var(--surface-2)] shadow-sm'>
      <div
        className={cn(
          'transition-opacity duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          contentVisible ? 'opacity-100' : 'opacity-0'
        )}
      >
        <WorkflowBlockContent block={block} />
      </div>
      <BlockHandles block={block} handlesVisible={handlesVisible} />
    </div>
  )
}
