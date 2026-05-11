import { Skeleton } from '@/components/emcn'

export function DataDrainsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-4.5'>
      <Skeleton className='h-[34px] w-full rounded-lg' />
      <div className='flex items-center gap-2'>
        <Skeleton className='h-[34px] flex-1 rounded-lg' />
        <Skeleton className='h-[34px] w-[110px] rounded-lg' />
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className='h-[64px] w-full rounded-lg' />
        ))}
      </div>
    </div>
  )
}
