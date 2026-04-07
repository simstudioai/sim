import { Skeleton } from '@/components/emcn'

export default function SSOLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[120px] rounded-[4px]' />
      <Skeleton className='mt-3 h-[14px] w-[260px] rounded-[4px]' />
      <div className='mt-8 w-full space-y-2'>
        <Skeleton className='h-[14px] w-[80px] rounded-[4px]' />
        <Skeleton className='h-[44px] w-full rounded-[10px]' />
      </div>
      <Skeleton className='mt-6 h-[44px] w-full rounded-[10px]' />
      <Skeleton className='mt-6 h-[14px] w-[120px] rounded-[4px]' />
    </div>
  )
}
