import { Skeleton } from '@/components/emcn'

export default function InviteLoading() {
  return (
    <div className='flex flex-col items-center justify-center'>
      <Skeleton className='h-[48px] w-[48px] rounded-[12px]' />
      <Skeleton className='mt-[16px] h-[24px] w-[200px] rounded-[4px]' />
      <Skeleton className='mt-[8px] h-[14px] w-[280px] rounded-[4px]' />
      <Skeleton className='mt-[4px] h-[14px] w-[240px] rounded-[4px]' />
      <Skeleton className='mt-[24px] h-[44px] w-[200px] rounded-[10px]' />
    </div>
  )
}
