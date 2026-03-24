import { Skeleton } from '@/components/emcn'

export default function OAuthConsentLoading() {
  return (
    <div className='flex flex-col items-center'>
      <div className='flex items-center gap-[16px]'>
        <Skeleton className='h-[48px] w-[48px] rounded-[12px]' />
        <Skeleton className='h-[20px] w-[20px] rounded-[4px]' />
        <Skeleton className='h-[48px] w-[48px] rounded-[12px]' />
      </div>
      <Skeleton className='mt-[24px] h-[38px] w-[220px] rounded-[4px]' />
      <Skeleton className='mt-[8px] h-[14px] w-[280px] rounded-[4px]' />
      <Skeleton className='mt-[24px] h-[56px] w-full rounded-[8px]' />
      <Skeleton className='mt-[16px] h-[120px] w-full rounded-[8px]' />
      <div className='mt-[24px] flex w-full max-w-[410px] gap-[12px]'>
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
        <Skeleton className='h-[44px] flex-1 rounded-[10px]' />
      </div>
    </div>
  )
}
