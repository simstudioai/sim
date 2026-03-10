import { Skeleton } from '@/components/ui'

/**
 * Skeleton component for API key list items.
 */
export function ApiKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          <Skeleton className='h-5 w-[80px]' />
          <Skeleton className='h-5 w-[140px]' />
        </div>
        <Skeleton className='h-5 w-[100px]' />
      </div>
      <Skeleton className='h-[26px] w-[48px] rounded-[6px]' />
    </div>
  )
}

/**
 * Skeleton for the API Keys section shown during dynamic import loading.
 */
export function ApiKeysSkeleton() {
  return (
    <div className='flex flex-col gap-[12px]'>
      <ApiKeySkeleton />
      <ApiKeySkeleton />
    </div>
  )
}
