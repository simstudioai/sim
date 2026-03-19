import { Skeleton } from '@/components/emcn'

export default function ChangelogLoading() {
  return (
    <div className='min-h-screen bg-background'>
      <div className='grid md:grid-cols-2'>
        <div className='relative p-8 md:sticky md:top-0 md:h-dvh md:p-12'>
          <div className='flex h-full flex-col justify-center'>
            <Skeleton className='h-[48px] w-[200px] rounded-[4px]' />
            <Skeleton className='mt-[16px] h-[16px] w-[300px] rounded-[4px]' />
            <Skeleton className='mt-[4px] h-[16px] w-[260px] rounded-[4px]' />
            <Skeleton className='mt-[24px] h-[1px] w-full rounded-[1px]' />
            <div className='mt-[24px] space-y-[12px]'>
              <Skeleton className='h-[16px] w-[140px] rounded-[4px]' />
              <Skeleton className='h-[16px] w-[120px] rounded-[4px]' />
              <Skeleton className='h-[16px] w-[100px] rounded-[4px]' />
            </div>
          </div>
        </div>
        <div className='p-8 pl-8 md:p-12'>
          <div className='max-w-2xl space-y-[32px]'>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className='space-y-[12px]'>
                <Skeleton className='h-[20px] w-[160px] rounded-[4px]' />
                <Skeleton className='h-[14px] w-[100px] rounded-[4px]' />
                <div className='space-y-[8px]'>
                  <Skeleton className='h-[14px] w-full rounded-[4px]' />
                  <Skeleton className='h-[14px] w-[90%] rounded-[4px]' />
                  <Skeleton className='h-[14px] w-[75%] rounded-[4px]' />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
