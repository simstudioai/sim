import { Skeleton } from '@/components/emcn'

const SKELETON_POST_COUNT = 4

export default function AuthorLoading() {
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <div className='mb-6 flex items-center gap-3'>
        <Skeleton className='h-[40px] w-[40px] rounded-full bg-[#2A2A2A]' />
        <Skeleton className='h-[32px] w-[160px] rounded-[4px] bg-[#2A2A2A]' />
      </div>
      <div className='grid grid-cols-1 gap-8 sm:grid-cols-2'>
        {Array.from({ length: SKELETON_POST_COUNT }).map((_, i) => (
          <div key={i} className='overflow-hidden rounded-lg border border-[#2A2A2A]'>
            <Skeleton className='h-[160px] w-full rounded-none bg-[#2A2A2A]' />
            <div className='p-3'>
              <Skeleton className='mb-1 h-[12px] w-[80px] rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='h-[14px] w-[200px] rounded-[4px] bg-[#2A2A2A]' />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
