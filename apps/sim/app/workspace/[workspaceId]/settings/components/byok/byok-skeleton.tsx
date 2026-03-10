import { Skeleton } from '@/components/ui'

/**
 * Skeleton component for BYOK provider key items.
 */
export function BYOKKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex items-center gap-[12px]'>
        <Skeleton className='h-9 w-9 flex-shrink-0 rounded-[6px]' />
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <Skeleton className='h-[14px] w-[100px]' />
          <Skeleton className='h-[13px] w-[200px]' />
        </div>
      </div>
      <Skeleton className='h-[32px] w-[72px] rounded-[6px]' />
    </div>
  )
}

/**
 * Skeleton for the BYOK section shown during dynamic import loading.
 */
export function BYOKSkeleton() {
  return (
    <div className='flex flex-col gap-[12px]'>
      <BYOKKeySkeleton />
      <BYOKKeySkeleton />
      <BYOKKeySkeleton />
    </div>
  )
}
