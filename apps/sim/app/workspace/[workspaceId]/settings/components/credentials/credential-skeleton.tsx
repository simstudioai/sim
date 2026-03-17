import { Skeleton } from '@/components/emcn'

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr)_8px_minmax(0,1fr)_auto] items-center'

/**
 * Skeleton component for a single secret row in the grid layout.
 */
export function CredentialSkeleton() {
  return (
    <div className={GRID_COLS}>
      <Skeleton className='h-9 rounded-[6px]' />
      <div />
      <Skeleton className='h-9 rounded-[6px]' />
      <div className='ml-[8px] flex items-center gap-0'>
        <Skeleton className='h-9 w-9 rounded-[6px]' />
        <Skeleton className='h-9 w-9 rounded-[6px]' />
      </div>
    </div>
  )
}

/**
 * Skeleton for the Secrets section shown during dynamic import loading.
 */
export function CredentialsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[16px]'>
      <div className='flex items-center gap-[8px]'>
        <Skeleton className='h-[30px] flex-1 rounded-[8px]' />
        <Skeleton className='h-[30px] w-[56px] rounded-[6px]' />
        <Skeleton className='h-[30px] w-[50px] rounded-[6px]' />
      </div>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-5 w-[70px]' />
        <div className='text-[13px] text-[var(--text-muted)]'>
          <Skeleton className='h-5 w-[160px]' />
        </div>
      </div>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-5 w-[55px]' />
        <CredentialSkeleton />
        <CredentialSkeleton />
      </div>
    </div>
  )
}
