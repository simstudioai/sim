import { Skeleton } from '@/components/emcn'

export default function BlogPostLoading() {
  return (
    <article className='w-full bg-[var(--landing-bg)]'>
      <div className='px-5 pt-[60px] lg:px-16 lg:pt-[100px]'>
        <div className='mb-6'>
          <Skeleton className='h-[16px] w-[100px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
        </div>
        <div className='flex flex-col gap-8 md:flex-row md:gap-12'>
          <div className='w-full flex-shrink-0 md:w-[450px]'>
            <Skeleton className='aspect-[450/360] w-full rounded-[5px] bg-[var(--landing-bg-elevated)]' />
          </div>
          <div className='flex flex-1 flex-col justify-between'>
            <div>
              <Skeleton className='h-[44px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='mt-2 h-[44px] w-[80%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='mt-4 h-[18px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='mt-2 h-[18px] w-[70%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            </div>
            <div className='mt-6 flex items-center gap-6'>
              <Skeleton className='h-[12px] w-[100px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <div className='flex items-center gap-2'>
                <Skeleton className='h-[20px] w-[20px] rounded-full bg-[var(--landing-bg-elevated)]' />
                <Skeleton className='h-[12px] w-[80px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className='mt-8 h-px w-full bg-[var(--landing-bg-elevated)]' />

      <div className='mx-5 border-[var(--landing-bg-elevated)] border-x lg:mx-16'>
        <div className='mx-auto max-w-[900px] px-6 py-16'>
          <div className='space-y-4'>
            <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='h-[16px] w-[95%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='h-[16px] w-[88%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='mt-6 h-[24px] w-[200px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='h-[16px] w-[92%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
            <Skeleton className='h-[16px] w-[85%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
          </div>
        </div>
      </div>

      <div className='-mt-px h-px w-full bg-[var(--landing-bg-elevated)]' />
    </article>
  )
}
