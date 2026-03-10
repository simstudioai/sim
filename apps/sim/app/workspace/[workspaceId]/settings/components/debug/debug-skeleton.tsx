import { Skeleton } from '@/components/emcn'

/**
 * Skeleton for the Debug section shown during dynamic import loading.
 * Matches the layout: description text + input/button row.
 */
export function DebugSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <Skeleton className='h-[14px] w-[340px]' />
      <div className='flex gap-[8px]'>
        <Skeleton className='h-9 flex-1 rounded-[6px]' />
        <Skeleton className='h-9 w-[80px] rounded-[6px]' />
      </div>
    </div>
  )
}
