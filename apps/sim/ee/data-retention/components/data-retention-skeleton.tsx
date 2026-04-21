import { Skeleton } from '@/components/emcn'

export function DataRetentionSkeleton() {
  return (
    <div className='flex flex-col gap-8'>
      <section>
        <Skeleton className='mb-4 h-[18px] w-[140px]' />
        <div className='flex flex-col gap-5'>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className='flex flex-col gap-1.5'>
              <Skeleton className='h-[14px] w-[100px]' />
              <Skeleton className='h-[12px] w-[300px]' />
              <Skeleton className='h-[36px] w-[200px] rounded-lg' />
            </div>
          ))}
        </div>
      </section>
      <div className='flex items-center justify-end'>
        <Skeleton className='h-[34px] w-[64px] rounded-lg' />
      </div>
    </div>
  )
}
