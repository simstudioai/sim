import { Skeleton } from '@/components/emcn'

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr)_8px_minmax(0,1fr)_auto_auto] items-center'
const COL_SPAN_ALL = 'col-span-5'

/**
 * Skeleton for a single secret row matching the secrets grid layout.
 */
function SecretRowSkeleton() {
  return (
    <div className='contents'>
      <Skeleton className='h-9 rounded-md' />
      <div />
      <Skeleton className='h-9 rounded-md' />
      <Skeleton className='ml-2 h-9 w-[60px] rounded-md' />
      <Skeleton className='size-9 rounded-md' />
    </div>
  )
}

/**
 * Skeleton for the Secrets page shown during dynamic import loading.
 */
export function SecretsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[30px] flex-1 rounded-lg' />
        <Skeleton className='h-[30px] w-[50px] rounded-md' />
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-4'>
          <div className={`${GRID_COLS} gap-y-2`}>
            <Skeleton className={`${COL_SPAN_ALL} h-5 w-[70px]`} />
            <SecretRowSkeleton />
            <SecretRowSkeleton />

            <div className={`${COL_SPAN_ALL} h-[8px]`} />

            <Skeleton className={`${COL_SPAN_ALL} h-5 w-[55px]`} />
            <SecretRowSkeleton />
            <SecretRowSkeleton />
          </div>
        </div>
      </div>
    </div>
  )
}
