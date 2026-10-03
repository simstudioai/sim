import { Skeleton } from '@sim/emcn'

export default function UnsubscribeLoading() {
  return (
    <div className='flex flex-col items-center justify-center'>
      <Skeleton className='size-[48px] rounded-xl' />
      <Skeleton className='mt-[16px] h-[24px] w-[180px] rounded-sm' />
      <Skeleton className='mt-[8px] h-[14px] w-[300px] rounded-sm' />
      <Skeleton className='mt-[4px] h-[14px] w-[260px] rounded-sm' />
      <Skeleton className='mt-[24px] h-[44px] w-[200px] rounded-lg' />
    </div>
  )
}
