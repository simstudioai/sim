import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for recently deleted list items.
 */
export function DeletedItemSkeleton() {
  return (
    <div className='flex items-center gap-[12px] px-[8px] py-[8px]'>
      <Skeleton className='h-[14px] w-[14px] shrink-0 rounded-[3px]' />
      <div className='flex min-w-0 flex-1 flex-col gap-[2px]'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[12px] w-[180px]' />
      </div>
      <Skeleton className='h-[30px] w-[64px] shrink-0 rounded-[6px]' />
    </div>
  )
}
