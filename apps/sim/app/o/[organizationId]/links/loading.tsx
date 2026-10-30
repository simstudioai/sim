import { cn } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import { PAGE_COLUMN_CLASS } from '@/app/o/[organizationId]/components/organization-page'

export default function SimLinksLoading() {
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER} />
      </div>
      <div className={cn(PAGE_COLUMN_CLASS, 'pt-8')}>
        <h1 className='text-[var(--text-primary)] text-lg'>Sim Links</h1>
        <p role='status' className='mt-4 text-[var(--text-muted)] text-small'>
          Loading Sim links
        </p>
      </div>
    </div>
  )
}
