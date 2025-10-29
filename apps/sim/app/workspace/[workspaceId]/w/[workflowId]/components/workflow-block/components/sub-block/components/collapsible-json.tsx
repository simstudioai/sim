import { Notice } from '@/components/ui'
import { JSONView } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/components'

interface CollapsibleJsonProps {
  blockId: string
  subBlockId: string
  data: any
  title?: string
  description?: string
}

export function CollapsibleJson({
  blockId,
  subBlockId,
  data,
  title,
  description,
}: CollapsibleJsonProps) {
  return (
    <div id={`${blockId}-${subBlockId}`}>
      <Notice
        variant='default'
        className='border-slate-200 bg-white dark:border-border dark:bg-background'
        icon={null}
        title={title}
      >
        {description && <div className='mb-2'>{description}</div>}
        <div className='overflow-wrap-anywhere whitespace-normal break-normal font-mono text-sm'>
          <JSONView data={data} />
        </div>
      </Notice>
    </div>
  )
}
