import { Skeleton } from '@sim/emcn'

export default function BlogLoading() {
  return (
    <section className='bg-[var(--bg)]'>
      <div className='mx-auto w-full max-w-[1460px]'>
        {/* Header skeleton */}
        <div className='px-20 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
          <Skeleton className='mb-5 h-[20px] w-[60px] rounded-md bg-[var(--surface-hover)]' />
          <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
            <Skeleton className='h-[40px] w-[240px] rounded-[4px] bg-[var(--surface-hover)]' />
            <Skeleton className='h-[18px] w-[320px] rounded-[4px] bg-[var(--surface-hover)]' />
          </div>
        </div>

        {/* Content area with vertical border rails */}
        <div className='mx-20 mt-8 border-[var(--border)] border-x max-sm:mx-5 max-lg:mx-8'>
          <div className='h-px w-full bg-[var(--border)]' />

          {/* Featured skeleton */}
          <div className='flex max-sm:flex-col'>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className='flex flex-1 flex-col gap-4 border-[var(--border)] p-6 max-sm:border-t max-sm:first:border-t-0 md:border-l md:first:border-l-0'
              >
                <Skeleton className='aspect-video w-full rounded-[5px] bg-[var(--surface-hover)]' />
                <div className='flex flex-col gap-2'>
                  <Skeleton className='h-[12px] w-[60px] rounded-[4px] bg-[var(--surface-hover)]' />
                  <Skeleton className='h-[20px] w-[80%] rounded-[4px] bg-[var(--surface-hover)]' />
                  <Skeleton className='h-[14px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
                </div>
              </div>
            ))}
          </div>

          <div className='h-px w-full bg-[var(--border)]' />

          {/* List skeleton */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <div className='flex items-center gap-6 p-6'>
                <Skeleton className='hidden h-[14px] w-[120px] rounded-[4px] bg-[var(--surface-hover)] md:block' />
                <div className='flex min-w-0 flex-1 flex-col gap-1'>
                  <Skeleton className='h-[18px] w-[70%] rounded-[4px] bg-[var(--surface-hover)]' />
                  <Skeleton className='h-[14px] w-[90%] rounded-[4px] bg-[var(--surface-hover)]' />
                </div>
                <Skeleton className='hidden h-[80px] w-[140px] rounded-[5px] bg-[var(--surface-hover)] sm:block' />
              </div>
              <div className='h-px w-full bg-[var(--border)]' />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
