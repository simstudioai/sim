import { AuthSkeleton as Skeleton } from '@sim/auth-ui'

export default function InviteLoading() {
  return (
    <div className='au:flex au:flex-col au:items-center au:justify-center'>
      <Skeleton className='au:size-[48px] au:rounded-[12px]' />
      <Skeleton className='au:mt-[16px] au:h-[24px] au:w-[200px] au:rounded-[4px]' />
      <Skeleton className='au:mt-[8px] au:h-[14px] au:w-[280px] au:rounded-[4px]' />
      <Skeleton className='au:mt-[4px] au:h-[14px] au:w-[240px] au:rounded-[4px]' />
      <Skeleton className='au:mt-[24px] au:h-[44px] au:w-[200px] au:rounded-[10px]' />
    </div>
  )
}
