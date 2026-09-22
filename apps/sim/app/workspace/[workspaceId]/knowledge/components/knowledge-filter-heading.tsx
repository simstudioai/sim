import { Button } from '@sim/emcn'
import { FILTER_SECTION_LABEL_CLASS } from '@/app/workspace/[workspaceId]/components'

interface KnowledgeFilterHeadingProps {
  title: string
  active: boolean
  onClear: () => void
}

/** Heading and conditional clear action for a knowledge-list filter. */
export function KnowledgeFilterHeading({ title, active, onClear }: KnowledgeFilterHeadingProps) {
  return (
    <div className='flex h-5 items-center justify-between'>
      <span className={FILTER_SECTION_LABEL_CLASS}>{title}</span>
      {active && (
        <Button
          variant='ghost'
          onClick={onClear}
          className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-xs hover-hover:text-[var(--text-secondary)]'
        >
          Clear
        </Button>
      )}
    </div>
  )
}
