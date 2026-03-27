import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for custom tool list items.
 */
export function CustomToolSkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <Skeleton className='h-[13px] w-[200px]' />
      </div>
      <div className='flex flex-shrink-0 items-center gap-2'>
        <Skeleton className='h-[30px] w-[40px] rounded-sm' />
        <Skeleton className='h-[30px] w-[54px] rounded-sm' />
      </div>
    </div>
  )
}

/**
 * Skeleton for the Custom Tools section shown during dynamic import loading.
 */
export function CustomToolsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[30px] flex-1 rounded-lg' />
        <Skeleton className='h-[30px] w-[64px] rounded-md' />
      </div>
      <div className='flex flex-col gap-2'>
        <CustomToolSkeleton />
        <CustomToolSkeleton />
        <CustomToolSkeleton />
      </div>
    </div>
  )
}
