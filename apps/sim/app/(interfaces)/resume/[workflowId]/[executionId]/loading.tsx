import { Skeleton } from '@sim/emcn'

export default function ResumeLoading() {
  return (
    <div className='bg-background'>
      <div className='border-b px-4 py-3'>
        <div className='mx-auto flex max-w-[1200px] items-center justify-between'>
          <Skeleton className='h-[24px] w-[80px] rounded-sm' />
          <Skeleton className='h-[28px] w-[100px] rounded-md' />
        </div>
      </div>
      <div className='mx-auto max-w-[1200px] px-6 py-8'>
        <div className='grid grid-cols-[280px_1fr] gap-6'>
          <div className='space-y-[8px]'>
            <Skeleton className='h-[20px] w-[120px] rounded-sm' />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-[48px] w-full rounded-lg' />
            ))}
          </div>
          <div className='rounded-lg border p-6'>
            <Skeleton className='h-[24px] w-[200px] rounded-sm' />
            <Skeleton className='mt-[12px] h-[16px] w-[320px] rounded-sm' />
            <div className='mt-[24px] space-y-[16px]'>
              <div className='space-y-[8px]'>
                <Skeleton className='h-[14px] w-[80px] rounded-sm' />
                <Skeleton className='h-[40px] w-full rounded-lg' />
              </div>
              <div className='space-y-[8px]'>
                <Skeleton className='h-[14px] w-[100px] rounded-sm' />
                <Skeleton className='h-[80px] w-full rounded-lg' />
              </div>
            </div>
            <div className='mt-[24px] flex gap-[12px]'>
              <Skeleton className='h-[40px] w-[120px] rounded-lg' />
              <Skeleton className='h-[40px] w-[120px] rounded-lg' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
