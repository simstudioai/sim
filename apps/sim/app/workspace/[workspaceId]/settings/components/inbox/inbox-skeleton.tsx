import { Skeleton } from '@/components/emcn'

/**
 * Skeleton for a single inbox task row.
 */
export function InboxTaskSkeleton() {
  return (
    <div className='flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-[14px] w-[200px]' />
        <Skeleton className='h-[12px] w-[50px]' />
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
 * Skeleton for the full Inbox section shown while data is loading.
 */
export function InboxSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center justify-between'>
        <div className='flex flex-col gap-0.5'>
          <Skeleton className='h-[14px] w-[140px]' />
          <Skeleton className='h-[13px] w-[260px]' />
        </div>
        <Skeleton className='h-[20px] w-[36px] rounded-full' />
      </div>

      <div className='border-[var(--border)] border-t' />

      <div className='flex flex-col gap-6'>
        <div className='flex flex-col gap-1.5'>
          <Skeleton className='h-[14px] w-[90px]' />
          <div className='flex items-center justify-between'>
            <Skeleton className='h-[13px] w-[200px]' />
            <div className='flex items-center gap-1.5'>
              <Skeleton className='h-[12px] w-[12px] rounded-sm' />
              <Skeleton className='h-[12px] w-[12px] rounded-sm' />
            </div>
          </div>
          <Skeleton className='h-9 w-full rounded-md' />
        </div>

        <div className='flex flex-col gap-1.5'>
          <Skeleton className='h-[14px] w-[110px]' />
          <Skeleton className='h-[13px] w-[260px]' />
          <div className='mt-1 overflow-hidden rounded-lg border border-[var(--border)]'>
            <div className='px-3 py-2.5'>
              <Skeleton className='h-[14px] w-[180px]' />
            </div>
            <div className='border-[var(--border)] border-t px-3 py-2.5'>
              <Skeleton className='h-[14px] w-[160px]' />
            </div>
          </div>
          <Skeleton className='mt-1 h-[32px] w-[100px] rounded-md' />
        </div>
      </div>

      <div className='border-[var(--border)] border-t pt-4'>
        <Skeleton className='h-[14px] w-[40px]' />
        <Skeleton className='mt-0.5 h-[13px] w-[220px]' />
      </div>

      <div className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <Skeleton className='h-[32px] flex-1 rounded-lg' />
          <Skeleton className='h-[32px] w-[100px] rounded-md' />
        </div>
        <div className='flex flex-col gap-1'>
          <InboxTaskSkeleton />
          <InboxTaskSkeleton />
          <InboxTaskSkeleton />
        </div>
      </div>
    </div>
  )
}
