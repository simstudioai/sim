import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for API key list items.
 */
export function ApiKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-1.5'>
          <Skeleton className='h-5 w-[80px]' />
          <Skeleton className='h-5 w-[140px]' />
        </div>
        <Skeleton className='h-5 w-[100px]' />
      </div>
      <Skeleton className='h-[26px] w-[48px] rounded-md' />
    </div>
  )
}

/**
 * Skeleton for the API Keys section shown during dynamic import loading.
 */
export function ApiKeysSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[38px] flex-1 rounded-lg' />
        <Skeleton className='h-[38px] w-[90px] rounded-md' />
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-4.5'>
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-5 w-[80px]' />
            <Skeleton className='h-5 w-[180px]' />
          </div>

          <div className='flex flex-col gap-2'>
            <Skeleton className='h-5 w-[60px]' />
            <ApiKeySkeleton />
            <ApiKeySkeleton />
          </div>
        </div>
      </div>

      <div className='mt-6 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <Skeleton className='h-5 w-[170px]' />
          <Skeleton className='h-3 w-3 rounded-full' />
        </div>
        <Skeleton className='h-5 w-9 rounded-full' />
      </div>
    </div>
  )
}
