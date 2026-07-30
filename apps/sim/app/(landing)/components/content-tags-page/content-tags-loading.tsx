import { Skeleton } from '@sim/emcn'

const TAG_SKELETON_COUNT = 12

/** Shared loading skeleton for a content section's tags route. */
export function ContentTagsLoading() {
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <Skeleton className='mb-6 h-[32px] w-[200px] rounded-[4px] bg-[var(--surface-hover)]' />
      <div className='flex flex-wrap gap-3'>
        {Array.from({ length: TAG_SKELETON_COUNT }).map((_, i) => (
          <Skeleton
            key={i}
            className='h-[30px] rounded-full bg-[var(--surface-hover)]'
            style={{ width: `${60 + (i % 4) * 24}px` }}
          />
        ))}
      </div>
    </main>
  )
}
