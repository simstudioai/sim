import { Skeleton } from '@sim/emcn'
import { PAGE_HEADER_BAR } from '@/components/page-header-bar'

/** Keeps Search chrome visible while its URL state is loading. */
export default function OrganizationSearchLoading() {
  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      <div className={PAGE_HEADER_BAR}>
        <Skeleton className='h-7 w-40' />
      </div>
      <div className='flex flex-1 items-center justify-center px-6'>
        <Skeleton className='h-28 w-full max-w-chat' />
      </div>
    </div>
  )
}
