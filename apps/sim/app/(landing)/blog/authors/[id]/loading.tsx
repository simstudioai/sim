import { Skeleton } from '@/components/emcn'

const SKELETON_POST_COUNT = 4

export default function AuthorLoading() {
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <div className='flex items-center gap-[12px]'>
        <Skeleton className='h-[40px] w-[40px] rounded-full' />
        <Skeleton className='h-[28px] w-[160px] rounded-[4px]' />
      </div>
      <div className='mt-[32px] grid grid-cols-1 gap-8 sm:grid-cols-2'>
        {Array.from({ length: SKELETON_POST_COUNT }).map((_, i) => (
          <div key={i} className='flex flex-col gap-[12px]'>
            <Skeleton className='aspect-[16/10] w-full rounded-[8px]' />
            <Skeleton className='h-[14px] w-[80px] rounded-[4px]' />
            <Skeleton className='h-[20px] w-[200px] rounded-[4px]' />
          </div>
        ))}
      </div>
    </main>
  )
}
