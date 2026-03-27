import { Skeleton } from '@/components/emcn'

export default function ChatLoading() {
  return (
    <div className='dark fixed inset-0 z-[100] flex flex-col bg-[var(--landing-bg)] text-[var(--landing-text)]'>
      <div className='border-[var(--border-1)] border-b px-4 py-3'>
        <div className='mx-auto flex max-w-3xl items-center justify-between'>
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-[28px] w-[28px] rounded-[6px]' />
            <Skeleton className='h-[18px] w-[120px] rounded-[4px]' />
          </div>
          <Skeleton className='h-[28px] w-[80px] rounded-[6px]' />
        </div>
      </div>
      <div className='flex min-h-0 flex-1 items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            <div className='space-y-2 text-center'>
              <Skeleton className='mx-auto h-8 w-32' />
              <Skeleton className='mx-auto h-4 w-48' />
            </div>
            <div className='mt-8 w-full space-y-8'>
              <div className='space-y-2'>
                <Skeleton className='h-4 w-16' />
                <Skeleton className='h-10 w-full rounded-[10px]' />
              </div>
              <Skeleton className='h-10 w-full rounded-[10px]' />
            </div>
          </div>
        </div>
      </div>
      <div className='relative p-3 pb-4 md:p-4 md:pb-6'>
        <div className='relative mx-auto max-w-3xl md:max-w-[748px]'>
          <Skeleton className='h-[48px] w-full rounded-[12px]' />
        </div>
      </div>
    </div>
  )
}
