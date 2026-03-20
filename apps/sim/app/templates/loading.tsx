import { Skeleton } from '@/components/emcn'

const SKELETON_CARD_COUNT = 8

export default function TemplatesLoading() {
  return (
    <div className='min-h-screen bg-white'>
      <div className='border-b px-6 py-3'>
        <div className='mx-auto flex max-w-[1200px] items-center justify-between'>
          <Skeleton className='h-[24px] w-[80px] rounded-[4px]' />
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
            <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
          </div>
        </div>
      </div>
      <div className='mx-auto max-w-[1200px] px-6 py-8'>
        <Skeleton className='h-[40px] w-[400px] rounded-[8px]' />
        <div className='mt-[16px] flex gap-[8px]'>
          <Skeleton className='h-[32px] w-[64px] rounded-[6px]' />
        </div>
        <div className='mt-[24px] grid grid-cols-1 gap-x-[20px] gap-y-[40px] md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
            <div key={i} className='h-[268px] w-full rounded-[8px] bg-[var(--surface-3)] p-[8px]'>
              <Skeleton className='h-[180px] w-full rounded-[6px]' />
              <div className='mt-[10px] px-[4px]'>
                <Skeleton className='h-[14px] w-[120px] rounded-[4px]' />
                <Skeleton className='mt-[6px] h-[12px] w-[180px] rounded-[4px]' />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
