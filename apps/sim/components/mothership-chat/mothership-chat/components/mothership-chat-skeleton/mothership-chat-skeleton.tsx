import { Skeleton } from '@sim/emcn-legacy'

const USER_ROW_CLASS = 'flex flex-col items-end gap-[6px] pt-2'

/**
 * Skeleton content rendered inside MothershipChat's scroll area
 * while chat history is being fetched.
 */
export function MothershipChatSkeleton() {
  return (
    <div className='space-y-4'>
      <div className={USER_ROW_CLASS}>
        <Skeleton className='h-[40px] w-[55%] rounded-[16px]' />
      </div>

      <div className='space-y-3'>
        <Skeleton className='h-[14px] w-[90%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[75%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[82%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[40%] rounded-[4px]' />
      </div>

      <div className={USER_ROW_CLASS}>
        <Skeleton className='h-[32px] w-[40%] rounded-[16px]' />
      </div>

      <div className='space-y-3'>
        <Skeleton className='h-[14px] w-[85%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[70%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[60%] rounded-[4px]' />
      </div>
    </div>
  )
}
