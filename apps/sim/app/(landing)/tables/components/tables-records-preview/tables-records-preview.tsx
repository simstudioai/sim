import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { TablesRecordsTable } from '@/app/(landing)/tables/components/tables-records-preview/tables-records-table'

/** A framed view of the same interactive Tables surface used in the homepage resource pane. */
export function TablesRecordsPreview() {
  return (
    <div className='absolute inset-0 isolate overflow-hidden bg-[var(--bg)]'>
      <div className='-translate-x-1/2 absolute top-20 left-1/2 h-[440px] w-[780px] max-w-[calc(100%_-_48px)] max-sm:top-8 max-sm:h-[410px]'>
        <div className='h-full overflow-hidden rounded-[10px] border border-[var(--border)] shadow-xs'>
          <TablesRecordsTable />
        </div>
        <EdgeFade ground='canvas' edges={['bottom']} depth='stage' />
      </div>
      <EdgeFade ground='canvas' edges={['top', 'left', 'right']} depth='preview' />
    </div>
  )
}
