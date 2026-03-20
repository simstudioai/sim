import { Skeleton } from '@/components/emcn'

export default function TemplateDetailLoading() {
  return (
    <div className='flex min-h-screen flex-col'>
      <div className='border-b px-6 py-3'>
        <div className='mx-auto flex max-w-[1200px] items-center justify-between'>
          <Skeleton className='h-[24px] w-[80px] rounded-[4px]' />
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
            <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
          </div>
        </div>
      </div>
      <div className='mx-auto w-full max-w-[1200px] px-6 pt-[24px] pb-[24px]'>
        <div className='flex items-center gap-[8px]'>
          <Skeleton className='h-[14px] w-[72px] rounded-[4px]' />
          <Skeleton className='h-[14px] w-[8px] rounded-[2px]' />
          <Skeleton className='h-[14px] w-[120px] rounded-[4px]' />
        </div>

        <div className='mt-[14px] flex items-center justify-between'>
          <Skeleton className='h-[27px] w-[250px] rounded-[4px]' />
          <div className='flex items-center gap-[8px]'>
            <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
            <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
          </div>
        </div>
        <Skeleton className='mt-[4px] h-[16px] w-[360px] rounded-[4px]' />
        <div className='mt-[16px] flex items-center gap-[8px]'>
          <Skeleton className='h-[16px] w-[48px] rounded-[4px]' />
          <Skeleton className='h-[16px] w-[48px] rounded-[4px]' />
          <Skeleton className='h-[16px] w-[1px] rounded-[1px]' />
          <Skeleton className='h-[20px] w-[20px] rounded-full' />
          <Skeleton className='h-[16px] w-[80px] rounded-[4px]' />
        </div>
        <Skeleton className='mt-[24px] h-[450px] w-full rounded-[8px]' />
        <Skeleton className='mt-[32px] h-[20px] w-[180px] rounded-[4px]' />
        <div className='mt-[12px] space-y-[8px]'>
          <Skeleton className='h-[14px] w-full rounded-[4px]' />
          <Skeleton className='h-[14px] w-[85%] rounded-[4px]' />
          <Skeleton className='h-[14px] w-[70%] rounded-[4px]' />
        </div>
        <Skeleton className='mt-[32px] h-[20px] w-[160px] rounded-[4px]' />
        <div className='mt-[12px] flex items-center gap-[12px]'>
          <Skeleton className='h-[48px] w-[48px] rounded-full' />
          <div className='space-y-[6px]'>
            <Skeleton className='h-[16px] w-[120px] rounded-[4px]' />
            <Skeleton className='h-[14px] w-[200px] rounded-[4px]' />
          </div>
        </div>
      </div>
    </div>
  )
}
