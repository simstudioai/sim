import { Skeleton } from '@sim/emcn'

export default function BlogPostLoading() {
  return (
    <article className='w-full bg-[var(--bg)]'>
      <div className='mx-auto w-full max-w-[1446px] px-12 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
        <div className='mb-6'>
          <Skeleton className='h-[16px] w-[100px] rounded-[4px] bg-[var(--surface-hover)]' />
        </div>
        <div className='flex flex-col gap-8 md:flex-row md:gap-12'>
          <div className='w-full flex-shrink-0 md:w-[450px]'>
            <Skeleton className='aspect-[450/360] w-full rounded-[5px] bg-[var(--surface-hover)]' />
          </div>
          <div className='flex flex-1 flex-col justify-between'>
            <div>
              <Skeleton className='h-[44px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='mt-2 h-[44px] w-[80%] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='mt-4 h-[18px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='mt-2 h-[18px] w-[70%] rounded-[4px] bg-[var(--surface-hover)]' />
            </div>
            <div className='mt-6 flex items-center gap-6'>
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

      <div className='mx-auto w-full max-w-[1446px]'>
        <div className='mx-12 border-[var(--border)] border-x max-sm:mx-5 max-lg:mx-8'>
          <div className='mx-auto max-w-[900px] px-6 py-16'>
            <div className='space-y-4'>
              <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-[95%] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-[88%] rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='h-[16px] w-full rounded-[4px] bg-[var(--surface-hover)]' />
              <Skeleton className='mt-6 h-[24px] w-[200px] rounded-[4px] bg-[var(--surface-hover)]' />
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
