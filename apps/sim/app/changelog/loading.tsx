import { Skeleton } from '@/components/emcn'

export default function ChangelogLoading() {
  return (
    <div className='min-h-screen'>
      <div className='relative grid md:grid-cols-2'>
        <div className='relative top-0 overflow-hidden border-[var(--landing-border)] border-b px-6 py-16 sm:px-10 md:sticky md:h-dvh md:border-r md:border-b-0 md:px-12 md:py-24'>
          <div className='relative mx-auto h-full max-w-xl md:flex md:flex-col md:justify-center'>
            <Skeleton className='mt-6 h-[48px] w-[200px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='mt-4 h-[14px] w-[300px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='mt-1 h-[14px] w-[260px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='mt-6 h-[1px] w-full bg-[var(--landing-bg-elevated)]' />
            <div className='mt-6 flex flex-wrap items-center gap-3'>
              <Skeleton className='h-[32px] w-[130px] rounded-[5px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='h-[32px] w-[120px] rounded-[5px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='h-[32px] w-[80px] rounded-[5px] bg-[var(--landing-bg-elevated)]' />
            </div>
          </div>
        </div>
        <div className='px-6 py-16 sm:px-10 md:px-12 md:py-24'>
          <div className='max-w-2xl space-y-8'>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className='space-y-3'>
                <Skeleton className='h-[20px] w-[160px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                <Skeleton className='h-[14px] w-[100px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                <div className='space-y-2'>
                  <Skeleton className='h-[14px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                  <Skeleton className='h-[14px] w-[90%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                  <Skeleton className='h-[14px] w-[75%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
