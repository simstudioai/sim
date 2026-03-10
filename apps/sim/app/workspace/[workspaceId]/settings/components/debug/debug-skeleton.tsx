import { Skeleton } from '@/components/emcn'

/**
 * Skeleton for the Debug section shown during dynamic import loading.
 */
export function DebugSkeleton() {
  return (
    <div className='flex flex-col gap-[8px]'>
      <Skeleton className='h-5 w-[200px]' />
      <Skeleton className='h-5 w-[140px]' />
    </div>
  )
}
