import { Skeleton } from '@/components/emcn'

const SKELETON_LINE_COUNT = 4

export default function HomeLoading() {
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='min-h-0 flex-1 overflow-hidden px-6 py-4'>
        <div className='mx-auto max-w-[42rem] space-y-[10px] pt-3'>
          {Array.from({ length: SKELETON_LINE_COUNT }).map((_, i) => (
            <Skeleton key={i} className='h-[16px]' style={{ width: `${120 + (i % 4) * 48}px` }} />
          ))}
        </div>
      </div>
      <div className='flex-shrink-0 px-[24px] pb-[16px]'>
        <div className='mx-auto max-w-[42rem]'>
          <Skeleton className='h-[48px] w-full rounded-[12px]' />
        </div>
      </div>
    </div>
  )
}
