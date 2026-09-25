import { Button } from '@sim/emcn'
import { FILTER_SECTION_LABEL_CLASS } from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'

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
        <Button variant='ghost-secondary' size='inline' onClick={onClear} className='-mr-1'>
          Clear
        </Button>
      )}
    </div>
  )
}
