import { Skeleton } from '@sim/emcn'

export default function SignupLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[100px] rounded-sm' />
      <div className='mt-8 w-full space-y-2'>
        <Skeleton className='h-[14px] w-[40px] rounded-sm' />
        <Skeleton className='h-[44px] w-full rounded-lg' />
      </div>
      <div className='mt-4 w-full space-y-2'>
        <Skeleton className='h-[14px] w-[40px] rounded-sm' />
        <Skeleton className='h-[44px] w-full rounded-lg' />
      </div>
      <div className='mt-4 w-full space-y-2'>
        <Skeleton className='h-[14px] w-[64px] rounded-sm' />
        <Skeleton className='h-[44px] w-full rounded-lg' />
      </div>
      <Skeleton className='mt-6 h-[44px] w-full rounded-lg' />
      <Skeleton className='mt-6 h-[1px] w-full rounded-full' />
      <div className='mt-6 flex w-full gap-3'>
        <Skeleton className='h-[44px] flex-1 rounded-lg' />
        <Skeleton className='h-[44px] flex-1 rounded-lg' />
      </div>
      <Skeleton className='mt-6 h-[14px] w-[220px] rounded-sm' />
    </div>
  )
}
