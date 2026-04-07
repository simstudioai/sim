import { Skeleton } from '@/components/emcn'

export default function OAuthConsentLoading() {
  return (
    <div className='flex flex-col items-center'>
      <div className='flex items-center gap-4'>
        <Skeleton className='h-[48px] w-[48px] rounded-[12px]' />
        <Skeleton className='h-[20px] w-[20px] rounded-[4px]' />
        <Skeleton className='h-[48px] w-[48px] rounded-[12px]' />
      </div>
      <Skeleton className='mt-6 h-[38px] w-[220px] rounded-[4px]' />
      <Skeleton className='mt-2 h-[14px] w-[280px] rounded-[4px]' />
      <Skeleton className='mt-6 h-[56px] w-full rounded-[8px]' />
      <Skeleton className='mt-4 h-[120px] w-full rounded-[8px]' />
      <div className='mt-6 flex w-full max-w-[410px] gap-3'>
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
      </div>
    </div>
  )
}
