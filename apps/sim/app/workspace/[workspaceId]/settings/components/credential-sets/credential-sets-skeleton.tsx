import { Skeleton } from '@/components/emcn'

/**
 * Skeleton for the Credential Sets (Email Polling) section shown during dynamic import loading.
 */
export function CredentialSetsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <div className='flex items-center gap-[8px]'>
        <Skeleton className='h-[30px] flex-1 rounded-[8px]' />
        <Skeleton className='h-[30px] w-[80px] rounded-[6px]' />
      </div>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-9 w-9 rounded-[6px]' />
            <div className='flex flex-col'>
              <Skeleton className='h-[14px] w-[120px]' />
              <Skeleton className='h-[12px] w-[80px]' />
            </div>
          </div>
          <Skeleton className='h-[32px] w-[60px] rounded-[6px]' />
        </div>
      </div>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-[14px] w-[60px]' />
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-9 w-9 rounded-[6px]' />
            <div className='flex flex-col'>
              <Skeleton className='h-[14px] w-[140px]' />
              <Skeleton className='h-[12px] w-[100px]' />
            </div>
          </div>
          <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
        </div>
      </div>
    </div>
  )
}
