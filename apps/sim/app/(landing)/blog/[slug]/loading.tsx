import { Skeleton } from '@/components/emcn'

export default function BlogPostLoading() {
  return (
    <article className='w-full'>
      {/* Header area */}
      <div className='mx-auto max-w-[1450px] px-6 pt-8 sm:px-8 sm:pt-12 md:px-12 md:pt-16'>
        {/* Back link */}
        <div className='mb-6'>
          <Skeleton className='h-[16px] w-[60px] rounded-[4px] bg-[#2A2A2A]' />
        </div>
        {/* Image + title row */}
        <div className='flex flex-col gap-8 md:flex-row md:gap-12'>
          {/* Image */}
          <div className='w-full flex-shrink-0 md:w-[450px]'>
            <Skeleton className='aspect-[450/360] w-full rounded-lg bg-[#2A2A2A]' />
          </div>
          {/* Title + author */}
          <div className='flex flex-1 flex-col justify-between'>
            <div>
              <Skeleton className='h-[48px] w-full rounded-[4px] bg-[#2A2A2A]' />
              <Skeleton className='mt-[8px] h-[48px] w-[80%] rounded-[4px] bg-[#2A2A2A]' />
            </div>
            <div className='mt-4 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Skeleton className='h-[24px] w-[24px] rounded-full bg-[#2A2A2A]' />
                <Skeleton className='h-[16px] w-[100px] rounded-[4px] bg-[#2A2A2A]' />
              </div>
              <Skeleton className='h-[32px] w-[32px] rounded-[6px] bg-[#2A2A2A]' />
            </div>
          </div>
        </div>
        {/* Divider */}
        <Skeleton className='mt-8 h-[1px] w-full bg-[#2A2A2A] sm:mt-12' />
        {/* Date + description */}
        <div className='flex flex-col gap-6 py-8 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:py-10'>
          <Skeleton className='h-[16px] w-[120px] flex-shrink-0 rounded-[4px] bg-[#2A2A2A]' />
          <div className='flex-1 space-y-[8px]'>
            <Skeleton className='h-[20px] w-full rounded-[4px] bg-[#2A2A2A]' />
            <Skeleton className='h-[20px] w-[70%] rounded-[4px] bg-[#2A2A2A]' />
          </div>
        </div>
      </div>
      {/* Article body */}
      <div className='mx-auto max-w-[900px] px-6 pb-20 sm:px-8 md:px-12'>
        <div className='space-y-[16px]'>
          <Skeleton className='h-[16px] w-full rounded-[4px] bg-[#2A2A2A]' />
          <Skeleton className='h-[16px] w-[95%] rounded-[4px] bg-[#2A2A2A]' />
          <Skeleton className='h-[16px] w-[88%] rounded-[4px] bg-[#2A2A2A]' />
          <Skeleton className='h-[16px] w-full rounded-[4px] bg-[#2A2A2A]' />
          <Skeleton className='mt-[24px] h-[24px] w-[200px] rounded-[4px] bg-[#2A2A2A]' />
          <Skeleton className='h-[16px] w-full rounded-[4px] bg-[#2A2A2A]' />
          <Skeleton className='h-[16px] w-[92%] rounded-[4px] bg-[#2A2A2A]' />
          <Skeleton className='h-[16px] w-[85%] rounded-[4px] bg-[#2A2A2A]' />
        </div>
      </div>
    </article>
  )
}
