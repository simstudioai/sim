import { Skeleton } from '@/components/emcn'

export function AdminSkeleton() {
  return (
    <div className='flex h-full flex-col gap-6'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[20px] w-[36px] rounded-full' />
      </div>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-[14px] w-[340px]' />
        <div className='flex gap-2'>
          <Skeleton className='h-9 flex-1 rounded-md' />
          <Skeleton className='h-9 w-[80px] rounded-md' />
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[200px] w-full rounded-lg' />
      </div>
    </div>
  )
}
