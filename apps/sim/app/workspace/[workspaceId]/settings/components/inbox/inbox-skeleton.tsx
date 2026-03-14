import { Skeleton } from '@/components/emcn'

/**
 * Skeleton for a single inbox task row.
 */
export function InboxTaskSkeleton() {
  return (
    <div className='flex flex-col gap-[4px] rounded-[8px] border border-[var(--border)] p-[12px]'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-[14px] w-[200px]' />
        <Skeleton className='h-[14px] w-[50px]' />
      </div>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-[12px] w-[140px]' />
        <Skeleton className='h-[20px] w-[70px] rounded-full' />
      </div>
      <Skeleton className='h-[12px] w-[260px]' />
    </div>
  )
}

/**
 * Skeleton for the full Inbox section shown during dynamic import loading.
 */
export function InboxSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <Skeleton className='h-[32px] w-full rounded-[8px]' />
      <Skeleton className='h-[20px] w-[140px] rounded-[4px]' />
      <Skeleton className='h-[40px] w-full rounded-[8px]' />
      <div className='flex flex-col gap-[6px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <Skeleton className='h-[13px] w-[200px]' />
        <Skeleton className='h-[40px] w-full rounded-[8px]' />
      </div>
      <div className='flex flex-col gap-[6px]'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[13px] w-[250px]' />
        <Skeleton className='h-[80px] w-full rounded-[8px]' />
      </div>
      <div className='border-[var(--border)] border-t pt-[16px]'>
        <Skeleton className='h-[14px] w-[40px]' />
        <Skeleton className='mt-[2px] h-[13px] w-[220px]' />
      </div>
      <div className='flex items-center gap-[8px]'>
        <Skeleton className='h-[30px] flex-1 rounded-[8px]' />
        <Skeleton className='h-[30px] w-[100px] rounded-[6px]' />
      </div>
      <div className='flex flex-col gap-[4px]'>
        <InboxTaskSkeleton />
        <InboxTaskSkeleton />
        <InboxTaskSkeleton />
      </div>
    </div>
  )
}
