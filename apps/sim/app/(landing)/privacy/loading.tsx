import { Skeleton } from '@/components/emcn'

export default function PrivacyLoading() {
  return (
    <main className='min-h-screen bg-[#1C1C1C] text-[#ECECEC]'>
      <div className='flex h-[52px] items-center border-[#2A2A2A] border-b px-6'>
        <Skeleton className='h-[22px] w-[60px] rounded-[4px] bg-[#2A2A2A]' />
        <div className='ml-auto flex items-center gap-[12px]'>
          <Skeleton className='h-[30px] w-[64px] rounded-[5px] bg-[#2A2A2A]' />
          <Skeleton className='h-[30px] w-[80px] rounded-[5px] bg-[#2A2A2A]' />
        </div>
      </div>
      <div className='mx-auto max-w-[800px] px-6 pt-[60px] pb-[80px] sm:px-12'>
        <Skeleton className='mx-auto h-[48px] w-[280px] rounded-[4px] bg-[#2A2A2A]' />
        <div className='mt-12 space-y-8'>
          <div className='space-y-[10px]'>
            <Skeleton className='h-[15px] w-[180px] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-full rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-[95%] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-[88%] rounded-[4px] bg-[#2A2A2A]' />
          </div>
          <div className='mt-12 space-y-[10px]'>
            <Skeleton className='h-[28px] w-[320px] rounded-[4px] bg-[#2A2A2A]' />
            <div className='mt-4 space-y-[10px]'>
              <Skeleton className='h-[20px] w-[160px] rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='h-[15px] w-full rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='h-[15px] w-[92%] rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='h-[15px] w-[85%] rounded-[4px] bg-[#2A2A2A]' />
            </div>
          </div>
          <div className='mt-12 space-y-[10px]'>
            <Skeleton className='h-[28px] w-[260px] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-full rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-[90%] rounded-[4px] bg-[#2A2A2A]' />
            <div className='mt-4 space-y-[8px] pl-6'>
              <Skeleton className='h-[15px] w-[70%] rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='h-[15px] w-[60%] rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='h-[15px] w-[75%] rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='h-[15px] w-[65%] rounded-[4px] bg-[#2A2A2A]' />
            </div>
          </div>
          <div className='mt-12 space-y-[10px]'>
            <Skeleton className='h-[28px] w-[300px] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-full rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-[95%] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-[88%] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-full rounded-[4px] bg-[#2A2A2A]' />
          </div>
          <div className='mt-12 space-y-[10px]'>
            <Skeleton className='h-[28px] w-[220px] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-full rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-[93%] rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[15px] w-[80%] rounded-[4px] bg-[#2A2A2A]' />
          </div>
        </div>
      </div>
    </main>
  )
}
