import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for BYOK provider key items.
 */
export function BYOKKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex items-center gap-3'>
        <Skeleton className='h-9 w-9 flex-shrink-0 rounded-md' />
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

/**
 * Skeleton for the BYOK section shown during dynamic import loading.
 */
export function BYOKSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[30px] flex-1 rounded-lg' />
      </div>
      <Skeleton className='h-[14px] w-[280px]' />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-2'>
          <BYOKKeySkeleton />
          <BYOKKeySkeleton />
          <BYOKKeySkeleton />
          <BYOKKeySkeleton />
          <BYOKKeySkeleton />
        </div>
      </div>
    </div>
  )
}
