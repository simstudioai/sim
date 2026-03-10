import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for credential list items.
 * Includes an icon placeholder for OAuth credentials.
 */
export function CredentialSkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 items-center gap-[10px]'>
        <Skeleton className='h-8 w-8 flex-shrink-0 rounded-[6px]' />
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <Skeleton className='h-[14px] w-[100px]' />
          <Skeleton className='h-[13px] w-[200px]' />
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center gap-[4px]'>
        <Skeleton className='h-[30px] w-[54px] rounded-[4px]' />
        <Skeleton className='h-[30px] w-[50px] rounded-[4px]' />
      </div>
    </div>
  )
}

/**
 * Skeleton for the Credentials section shown during dynamic import loading.
 */
export function CredentialsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <div className='flex items-center gap-[8px]'>
        <Skeleton className='h-[30px] flex-1 rounded-[8px]' />
        <Skeleton className='h-[30px] w-[64px] rounded-[6px]' />
      </div>
      <div className='flex flex-col gap-[8px]'>
        <CredentialSkeleton />
        <CredentialSkeleton />
        <CredentialSkeleton />
      </div>
    </div>
  )
}
