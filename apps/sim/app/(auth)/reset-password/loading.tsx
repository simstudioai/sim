import { Skeleton } from '@/components/emcn'

export default function ResetPasswordLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[160px] rounded-[4px]' />
      <Skeleton className='mt-[12px] h-[14px] w-[280px] rounded-[4px]' />
      <div className='mt-[32px] w-full space-y-[8px]'>
        <Skeleton className='h-[14px] w-[40px] rounded-[4px]' />
        <Skeleton className='h-[44px] w-full rounded-[10px]' />
      </div>
      <Skeleton className='mt-[24px] h-[44px] w-full rounded-[10px]' />
      <Skeleton className='mt-[24px] h-[14px] w-[120px] rounded-[4px]' />
    </div>
  )
}
