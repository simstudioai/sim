import { Skeleton } from '@/components/emcn'

const SKELETON_TAG_COUNT = 12

export default function TagsLoading() {
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <Skeleton className='h-[38px] w-[180px] rounded-[4px]' />
      <div className='mt-[24px] flex flex-wrap gap-3'>
        {Array.from({ length: SKELETON_TAG_COUNT }).map((_, i) => (
          <Skeleton
            key={i}
            className='h-[30px] rounded-full'
            style={{ width: `${60 + (i % 4) * 24}px` }}
          />
        ))}
      </div>
    </main>
  )
}
