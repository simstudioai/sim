import { Skeleton } from '@/components/emcn'

export default function LoginLoading() {
  return (
    <div className='flex flex-col items-center'>
      <Skeleton className='h-[38px] w-[80px] rounded-[4px]' />
      <div className='mt-8 w-full space-y-2'>
        <Skeleton className='h-[14px] w-[40px] rounded-[4px]' />
        <Skeleton className='h-[44px] w-full rounded-[10px]' />
      </div>
      <div className='mt-4 w-full space-y-2'>
        <Skeleton className='h-[14px] w-[64px] rounded-[4px]' />
        <Skeleton className='h-[44px] w-full rounded-[10px]' />
      </div>
      <Skeleton className='mt-6 h-[44px] w-full rounded-[10px]' />
      <Skeleton className='mt-6 h-[1px] w-full rounded-[1px]' />
      <div className='mt-6 flex w-full gap-3'>
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
      </div>
      <Skeleton className='mt-6 h-[14px] w-[200px] rounded-[4px]' />
    </div>
  )
}
