import { cn, Skeleton } from '@sim/emcn'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'

/** Shared loading skeleton for a content section's post-detail route. */
export function ContentPostLoading() {
  return (
    <article className='w-full bg-[var(--bg)]'>
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, 'pt-[112px] max-sm:pt-20')}>
        <div className='mb-6'>
          <Skeleton className='h-[16px] w-[100px] rounded-[4px] bg-[var(--surface-hover)]' />
        </div>
        <div className='flex min-w-0 flex-col gap-8 lg:flex-row lg:gap-12'>
          <div className='w-full shrink-0 lg:w-[40%] lg:max-w-[450px]'>
            <Skeleton className='aspect-[450/360] w-full rounded-[5px] bg-[var(--surface-hover)]' />
          </div>
          <div className='flex min-w-0 flex-1 flex-col justify-between'>
            <div>
              <Skeleton className='h-[44px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='mt-2 h-[44px] w-[80%] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='mt-4 h-[18px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='mt-2 h-[18px] w-[70%] rounded-[4px] bg-[var(--surface-hover)]' />
            </div>
            <div className='mt-6 flex flex-wrap items-center gap-6'>
              <Skeleton className='h-[12px] w-[100px] rounded-[4px] bg-[var(--surface-hover)]' />
              <div className='flex items-center gap-2'>
                <Skeleton className='size-[20px] rounded-full bg-[var(--surface-hover)]' />
                <Skeleton className='h-[12px] w-[80px] rounded-[4px] bg-[var(--surface-hover)]' />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className='mt-8 h-px w-full bg-[var(--border)]' />

      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div className='border-[var(--border)] border-x'>
          <div className='mx-auto max-w-[900px] px-6 py-16'>
            <div className='space-y-4'>
              <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-[95%] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-[88%] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[24px] w-[200px] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-[92%] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-[85%] rounded-[4px] bg-[var(--surface-hover)]' />
            </div>
          </div>
        </div>
      </div>

      <div className='-mt-px h-px w-full bg-[var(--border)]' />
    </article>
  )
}
