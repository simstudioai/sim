import { Skeleton } from '@/components/emcn'

export function DataDrainsSkeleton() {
  return (
    <div className='flex flex-col gap-8'>
      <div className='flex items-center justify-between'>
        <Skeleton className='h-[18px] w-[200px]' />
        <Skeleton className='h-[34px] w-[110px] rounded-lg' />
      </div>
      <div className='flex flex-col gap-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className='h-[64px] w-full rounded-lg' />
        ))}
      </div>
    </div>
  )
}
