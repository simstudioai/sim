import { Skeleton } from '@/components/emcn'

export default function PrivacyLoading() {
  return (
    <main className='min-h-screen bg-white text-gray-900'>
      <div className='px-12 pt-[40px] pb-[40px]'>
        <Skeleton className='mx-auto h-[48px] w-[240px] rounded-[4px]' />
        <div className='prose prose-gray mx-auto mt-[32px] space-y-8'>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className='space-y-[12px]'>
              <Skeleton className='h-[24px] w-[200px] rounded-[4px]' />
              <Skeleton className='h-[16px] w-full rounded-[4px]' />
              <Skeleton className='h-[16px] w-[95%] rounded-[4px]' />
              <Skeleton className='h-[16px] w-[88%] rounded-[4px]' />
              <Skeleton className='h-[16px] w-full rounded-[4px]' />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
