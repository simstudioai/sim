import { Skeleton } from '@/components/emcn'

/**
 * Skeleton for a single integration row matching the flex card layout.
 */
function IntegrationItemSkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-2.5'>
        <Skeleton className='h-8 w-8 flex-shrink-0 rounded-md' />
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <Skeleton className='h-4 w-[120px]' />
          <Skeleton className='h-3.5 w-[180px]' />
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center gap-1'>
        <Skeleton className='h-8 w-[60px] rounded-md' />
        <Skeleton className='h-8 w-[85px] rounded-md' />
      </div>
    </div>
  )
}

/**
 * Skeleton for the Integrations section shown during dynamic import loading.
 */
export function IntegrationsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[30px] flex-1 rounded-lg' />
        <Skeleton className='h-[30px] w-[100px] rounded-md' />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-2'>
          <IntegrationItemSkeleton />
          <IntegrationItemSkeleton />
          <IntegrationItemSkeleton />
        </div>
      </div>
    </div>
  )
}
