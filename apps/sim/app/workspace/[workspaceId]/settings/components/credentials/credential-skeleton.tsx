import { Skeleton } from '@/components/emcn'

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr)_8px_minmax(0,1fr)_auto_auto] items-center'
const COL_SPAN_ALL = 'col-span-5'

/**
 * Skeleton for a single integration credential row.
 */
export function CredentialSkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-2.5'>
        <Skeleton className='h-8 w-8 flex-shrink-0 rounded-md' />
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <Skeleton className='h-4 w-[120px] rounded' />
          <Skeleton className='h-3.5 w-[160px] rounded' />
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center gap-1'>
        <Skeleton className='h-9 w-[60px] rounded-md' />
        <Skeleton className='h-9 w-[88px] rounded-md' />
      </div>
    </div>
  )
}

/**
 * Skeleton for a single secret row matching the credentials grid layout.
 */
function CredentialRowSkeleton() {
  return (
    <div className='contents'>
      <Skeleton className='h-9 rounded-md' />
      <div />
      <Skeleton className='h-9 rounded-md' />
      <Skeleton className='ml-2 h-9 w-[60px] rounded-md' />
      <Skeleton className='h-9 w-9 rounded-md' />
    </div>
  )
}

/**
 * Skeleton for the Credentials (Secrets) page shown during dynamic import loading.
 */
export function CredentialsSkeleton() {
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
            <CredentialRowSkeleton />
            <CredentialRowSkeleton />

            <div className={`${COL_SPAN_ALL} h-[8px]`} />

            <Skeleton className={`${COL_SPAN_ALL} h-5 w-[55px]`} />
            <CredentialRowSkeleton />
            <CredentialRowSkeleton />
          </div>
        </div>
      </div>
    </div>
  )
}
