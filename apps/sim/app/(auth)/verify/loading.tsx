import { Skeleton } from '@/components/emcn'

export default function VerifyLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[180px] rounded-[4px]' />
      <Skeleton className='mt-[12px] h-[14px] w-[300px] rounded-[4px]' />
      <Skeleton className='mt-[4px] h-[14px] w-[240px] rounded-[4px]' />
      <Skeleton className='mt-[32px] h-[44px] w-full rounded-[10px]' />
    </div>
  )
}
