import { Skeleton } from '@/components/emcn'

export default function BlogPostLoading() {
  return (
    <article className='w-full'>
      <div className='mx-auto max-w-[1450px] px-6 pt-8'>
        <Skeleton className='h-[16px] w-[60px] rounded-[4px]' />
        <div className='mt-[24px] flex flex-col gap-8 md:flex-row md:gap-12'>
          <Skeleton className='aspect-[4/3] w-full rounded-[8px] md:w-[450px]' />
          <div className='flex flex-1 flex-col justify-center'>
            <Skeleton className='h-[48px] w-full rounded-[4px]' />
            <Skeleton className='mt-[8px] h-[48px] w-[80%] rounded-[4px]' />
            <div className='mt-[24px] flex items-center gap-[12px]'>
              <Skeleton className='h-[32px] w-[32px] rounded-full' />
              <Skeleton className='h-[16px] w-[100px] rounded-[4px]' />
            </div>
          </div>
        </div>
        <Skeleton className='mt-[32px] h-[1px] w-full rounded-[1px]' />
        <div className='mt-[16px] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <Skeleton className='h-[14px] w-[120px] rounded-[4px]' />
          <Skeleton className='h-[14px] w-[300px] rounded-[4px]' />
        </div>
      </div>
      <div className='mx-auto max-w-[900px] px-6 pt-[48px] pb-20'>
        <div className='space-y-[16px]'>
          <Skeleton className='h-[16px] w-full rounded-[4px]' />
          <Skeleton className='h-[16px] w-[95%] rounded-[4px]' />
          <Skeleton className='h-[16px] w-[88%] rounded-[4px]' />
          <Skeleton className='h-[16px] w-full rounded-[4px]' />
          <Skeleton className='mt-[24px] h-[24px] w-[200px] rounded-[4px]' />
          <Skeleton className='h-[16px] w-full rounded-[4px]' />
          <Skeleton className='h-[16px] w-[92%] rounded-[4px]' />
          <Skeleton className='h-[16px] w-[85%] rounded-[4px]' />
        </div>
      </div>
    </article>
  )
}
