import { Skeleton } from '@/components/emcn'

/**
 * Skeleton for a single integration credential row.
 */
export function CredentialSkeleton() {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-2.5'>
        <Skeleton className='size-8 flex-shrink-0 rounded-md' />
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <Skeleton className='h-4 w-[120px] rounded' />
          <Skeleton className='h-3.5 w-[160px] rounded' />
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center gap-1'>
        <Skeleton className='h-9 w-[60px] rounded-md' />
        <Skeleton className='h-9 w-[88px] rounded-md' />
      </div>
    </div>
  )
}
