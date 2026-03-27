import { Skeleton } from '@/components/emcn'

const SKELETON_CARD_COUNT = 6

export default function BlogLoading() {
  return (
    <main className='mx-auto max-w-[1200px] px-6 py-12 sm:px-8 md:px-12'>
      <Skeleton className='h-[48px] w-[100px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
      <Skeleton className='mt-3 h-[18px] w-[420px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
      <div className='mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3'>
        {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
          <div
            key={i}
            className='flex flex-col overflow-hidden rounded-xl border border-[var(--landing-border)]'
          >
            <Skeleton className='aspect-video w-full rounded-none bg-[var(--landing-bg-elevated)]' />
            <div className='flex flex-1 flex-col p-4'>
              <Skeleton className='mb-2 h-[12px] w-[80px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='mb-1 h-[20px] w-[85%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='mb-3 h-[14px] w-full rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <Skeleton className='h-[14px] w-[70%] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              <div className='mt-3 flex items-center gap-2'>
                <Skeleton className='h-[16px] w-[16px] rounded-full bg-[var(--landing-bg-elevated)]' />
                <Skeleton className='h-[12px] w-[80px] rounded-[4px] bg-[var(--landing-bg-elevated)]' />
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
