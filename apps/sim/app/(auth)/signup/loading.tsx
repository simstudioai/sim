import { Skeleton } from '@/components/emcn'

export default function SignupLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[100px] rounded-[4px]' />
      <div className='mt-[32px] w-full space-y-[8px]'>
        <Skeleton className='h-[14px] w-[40px] rounded-[4px]' />
        <Skeleton className='h-[44px] w-full rounded-[10px]' />
      </div>
      <div className='mt-[16px] w-full space-y-[8px]'>
        <Skeleton className='h-[14px] w-[40px] rounded-[4px]' />
        <Skeleton className='h-[44px] w-full rounded-[10px]' />
      </div>
      <div className='mt-[16px] w-full space-y-[8px]'>
        <Skeleton className='h-[14px] w-[64px] rounded-[4px]' />
        <Skeleton className='h-[44px] w-full rounded-[10px]' />
      </div>
      <Skeleton className='mt-[24px] h-[44px] w-full rounded-[10px]' />
      <Skeleton className='mt-[24px] h-[1px] w-full rounded-[1px]' />
      <div className='mt-[24px] flex w-full gap-[12px]'>
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
      </div>
      <Skeleton className='mt-[24px] h-[14px] w-[220px] rounded-[4px]' />
    </div>
  )
}
