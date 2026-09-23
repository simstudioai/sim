import { Skeleton } from '@sim/emcn'

export default function SSOLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[120px] rounded-sm' />
      <Skeleton className='mt-3 h-[14px] w-[260px] rounded-sm' />
      <div className='mt-8 w-full space-y-2'>
        <Skeleton className='h-[14px] w-[80px] rounded-sm' />
        <Skeleton className='h-[44px] w-full rounded-lg' />
      </div>
      <Skeleton className='mt-6 h-[44px] w-full rounded-lg' />
      <Skeleton className='mt-6 h-[14px] w-[120px] rounded-sm' />
    </div>
  )
}
