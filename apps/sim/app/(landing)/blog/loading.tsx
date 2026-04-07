import { Skeleton } from '@/components/emcn'

export default function BlogLoading() {
  return (
    <section className='bg-[var(--landing-bg)]'>
      {/* Header skeleton */}
      <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
        <Skeleton className='mb-5 h-[20px] w-[60px] rounded-md bg-[var(--landing-bg-elevated)]' />
        <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <Skeleton className='h-[40px] w-[240px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
          <Skeleton className='h-[18px] w-[320px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
        </div>
      </div>

      {/* Content area with vertical border rails */}
      <div className='mx-5 mt-8 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
        <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

        {/* Featured skeleton */}
        <div className='flex'>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className='flex flex-1 flex-col gap-4 border-[var(--landing-bg-elevated)] p-6 md:border-l md:first:border-l-0'
            >
              <Skeleton className='aspect-video w-full rounded-[5px] bg-[var(--landing-bg-elevated)]' />
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-[12px] w-[60px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                <Skeleton className='h-[20px] w-[80%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                <Skeleton className='h-[14px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              </div>
            </div>
          ))}
        </div>

        <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

        {/* List skeleton */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <div className='flex items-center gap-6 px-6 py-6'>
              <Skeleton className='hidden h-[14px] w-[120px] rounded-[4px] bg-[var(--landing-bg-elevated)] md:block' />
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <Skeleton className='h-[18px] w-[70%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                <Skeleton className='h-[14px] w-[90%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              </div>
              <Skeleton className='hidden h-[80px] w-[140px] rounded-[5px] bg-[var(--landing-bg-elevated)] sm:block' />
            </div>
            <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />
          </div>
        ))}
      </div>
    </section>
  )
}
