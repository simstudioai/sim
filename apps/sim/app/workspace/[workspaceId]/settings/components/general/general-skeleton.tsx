import { Skeleton } from '@/components/emcn'

/**
 * Skeleton component for general settings loading state.
 * Matches the exact layout structure of the General component.
 */
export function GeneralSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-3'>
        <Skeleton className='h-9 w-9 rounded-full' />
        <div className='flex flex-1 flex-col justify-center gap-[1px]'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-5 w-24' />
            <Skeleton className='h-[10.5px] w-[10.5px]' />
          </div>
          <Skeleton className='h-5 w-40' />
        </div>
      </div>

      <div className='flex items-center justify-between border-b pb-3'>
        <Skeleton className='h-4 w-12' />
        <Skeleton className='h-8 w-[100px] rounded-sm' />
      </div>

      <div className='flex items-center justify-between'>
        <Skeleton className='h-4 w-36' />
        <Skeleton className='h-[17px] w-[30px] rounded-full' />
      </div>

      <div className='flex items-center justify-between'>
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-[17px] w-[30px] rounded-full' />
      </div>

      <div className='flex items-center justify-between'>
        <Skeleton className='h-4 w-20' />
        <Skeleton className='h-8 w-[100px] rounded-sm' />
      </div>

      <div className='flex items-center justify-between'>
        <Skeleton className='h-4 w-32' />
        <Skeleton className='h-[17px] w-[30px] rounded-full' />
      </div>

      <div className='flex items-center justify-between border-t pt-4'>
        <Skeleton className='h-4 w-44' />
        <Skeleton className='h-[17px] w-[30px] rounded-full' />
      </div>

      <div className='-mt-2 flex flex-col gap-1'>
        <Skeleton className='h-[12px] w-full' />
        <Skeleton className='h-[12px] w-4/5' />
      </div>

      <div className='mt-auto flex items-center gap-2'>
        <Skeleton className='h-8 w-20 rounded-sm' />
        <Skeleton className='h-8 w-28 rounded-sm' />
        <Skeleton className='ml-auto h-8 w-24 rounded-sm' />
      </div>
    </div>
  )
}
