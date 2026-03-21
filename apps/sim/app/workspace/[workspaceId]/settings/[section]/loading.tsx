import { Skeleton } from '@/components/emcn'

export default function SettingsLoading() {
  return (
    <div>
      <Skeleton className='mb-[28px] h-[28px] w-[140px] rounded-[4px]' />
      <div className='flex flex-col gap-[16px]'>
        <Skeleton className='h-[20px] w-[200px] rounded-[4px]' />
        <Skeleton className='h-[40px] w-full rounded-[8px]' />
        <Skeleton className='h-[40px] w-full rounded-[8px]' />
        <Skeleton className='h-[40px] w-full rounded-[8px]' />
      </div>
    </div>
  )
}
