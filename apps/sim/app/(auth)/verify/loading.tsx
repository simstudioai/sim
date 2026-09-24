import { Skeleton } from '@sim/emcn'

export default function VerifyLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[180px] rounded-sm' />
      <Skeleton className='mt-3 h-[14px] w-[300px] rounded-sm' />
      <Skeleton className='mt-1 h-[14px] w-[240px] rounded-sm' />
      <Skeleton className='mt-8 h-[44px] w-full rounded-lg' />
    </div>
  )
}
