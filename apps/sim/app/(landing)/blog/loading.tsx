import { Skeleton } from '@/components/emcn'

const SKELETON_CARD_COUNT = 6

export default function StudioLoading() {
  return (
    <main className='mx-auto max-w-[1200px] px-6 py-12 sm:px-8 md:px-12'>
      <Skeleton className='h-[48px] w-[200px] rounded-[4px]' />
      <Skeleton className='mt-[8px] h-[20px] w-[360px] rounded-[4px]' />
      <div className='mt-[32px] grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3'>
        {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
          <div key={i} className='flex flex-col gap-[12px]'>
            <Skeleton className='aspect-[16/10] w-full rounded-[8px]' />
            <Skeleton className='h-[14px] w-[80px] rounded-[4px]' />
            <Skeleton className='h-[20px] w-[200px] rounded-[4px]' />
            <Skeleton className='h-[14px] w-full rounded-[4px]' />
            <Skeleton className='h-[14px] w-[70%] rounded-[4px]' />
          </div>
        ))}
      </div>
    </main>
  )
}
