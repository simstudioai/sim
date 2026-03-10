import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for custom tool list items.
 */
export function CustomToolSkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <Skeleton className='h-[13px] w-[200px]' />
      </div>
      <div className='flex flex-shrink-0 items-center gap-[8px]'>
        <Skeleton className='h-[30px] w-[40px] rounded-[4px]' />
        <Skeleton className='h-[30px] w-[54px] rounded-[4px]' />
      </div>
    </div>
  )
}

/**
 * Skeleton for the Custom Tools section shown during dynamic import loading.
 */
export function CustomToolsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <div className='flex items-center gap-[8px]'>
        <Skeleton className='h-[30px] flex-1 rounded-[8px]' />
        <Skeleton className='h-[30px] w-[64px] rounded-[6px]' />
      </div>
      <div className='flex flex-col gap-[8px]'>
        <CustomToolSkeleton />
        <CustomToolSkeleton />
        <CustomToolSkeleton />
      </div>
    </div>
  )
}
