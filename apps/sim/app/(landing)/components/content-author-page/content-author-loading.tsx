import { Skeleton } from '@sim/emcn'

const AUTHOR_POST_SKELETON_COUNT = 4

/** Shared loading skeleton for a content section's author-profile route. */
export function ContentAuthorLoading() {
  return (
    <section className='bg-[var(--bg)]'>
      <div className='mx-auto w-full max-w-[1460px] px-20 pt-[112px] max-sm:px-5 max-sm:pt-20 max-lg:px-8'>
        <Skeleton className='mb-6 h-[16px] w-[100px] rounded-md bg-[var(--surface-hover)]' />
        <div className='flex items-center gap-4'>
          <Skeleton className='size-[64px] rounded-full bg-[var(--surface-hover)]' />
          <Skeleton className='h-[40px] w-[240px] rounded-[4px] bg-[var(--surface-hover)]' />
        </div>
      </div>

      <div className='mx-20 mt-8 border-[var(--border)] border-x max-sm:mx-5 max-lg:mx-8'>
        <div className='h-px w-full bg-[var(--border)]' />

        {Array.from({ length: AUTHOR_POST_SKELETON_COUNT }).map((_, i) => (
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
    </section>
  )
}
