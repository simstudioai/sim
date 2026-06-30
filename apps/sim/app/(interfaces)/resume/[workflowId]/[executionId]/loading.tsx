import { Skeleton } from '@/components/emcn'

export default function ResumeLoading() {
  return (
    <div className='min-h-screen bg-background'>
      <div className='border-b px-4 py-3'>
        <div className='mx-auto flex max-w-[1200px] items-center justify-between'>
          <Skeleton className='h-[24px] w-[80px] rounded-[4px]' />
          <Skeleton className='h-[28px] w-[100px] rounded-[6px]' />
        </div>
      </div>
      <div className='mx-auto max-w-[1200px] px-6 py-8'>
        <div className='grid grid-cols-[280px_1fr] gap-6'>
          <div className='space-y-[8px]'>
            <Skeleton className='h-[20px] w-[120px] rounded-[4px]' />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-[48px] w-full rounded-[8px]' />
            ))}
          </div>
          <div className='rounded-[8px] border p-6'>
            <Skeleton className='h-[24px] w-[200px] rounded-[4px]' />
            <Skeleton className='mt-[12px] h-[16px] w-[320px] rounded-[4px]' />
            <div className='mt-[24px] space-y-[16px]'>
              <div className='space-y-[8px]'>
                <Skeleton className='h-[14px] w-[80px] rounded-[4px]' />
                <Skeleton className='h-[40px] w-full rounded-[8px]' />
              </div>
              <div className='space-y-[8px]'>
                <Skeleton className='h-[14px] w-[100px] rounded-[4px]' />
                <Skeleton className='h-[80px] w-full rounded-[8px]' />
              </div>
            </div>
            <div className='mt-[24px] flex gap-[12px]'>
              <Skeleton className='h-[40px] w-[120px] rounded-[8px]' />
              <Skeleton className='h-[40px] w-[120px] rounded-[8px]' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
