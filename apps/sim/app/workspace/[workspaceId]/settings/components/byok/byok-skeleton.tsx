import { Skeleton } from '@sim/emcn'

/**
 * Skeleton component for BYOK provider key items.
 */
export function BYOKKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex items-center gap-3'>
        <Skeleton className='size-9 flex-shrink-0 rounded-md' />
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <Skeleton className='h-[16px] w-[100px]' />
          <Skeleton className='h-[14px] w-[200px]' />
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center gap-2'>
        <Skeleton className='h-[32px] w-[72px] rounded-md' />
        <Skeleton className='h-[32px] w-[64px] rounded-md' />
      </div>
    </div>
  )
}
