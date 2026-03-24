import { Skeleton } from '@/components/emcn'

export function AdminSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[24px]'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[20px] w-[36px] rounded-full' />
      </div>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-[14px] w-[340px]' />
        <div className='flex gap-[8px]'>
          <Skeleton className='h-9 flex-1 rounded-[6px]' />
          <Skeleton className='h-9 w-[80px] rounded-[6px]' />
        </div>
      </div>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[200px] w-full rounded-[8px]' />
      </div>
    </div>
  )
}
