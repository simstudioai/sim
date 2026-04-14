import { Skeleton } from '@/components/emcn'

const LAYOUT_SKELETON_STYLES = {
  'mothership-view': {
    content: 'mx-auto max-w-[42rem] space-y-6',
    userRow: 'flex flex-col items-end gap-[6px] pt-3',
  },
  'copilot-view': {
    content: 'space-y-4',
    userRow: 'flex flex-col items-end gap-[6px] pt-2',
  },
} as const

interface MothershipChatSkeletonProps {
  layout?: 'mothership-view' | 'copilot-view'
}

/**
 * Skeleton content rendered inside MothershipChat's scroll area
 * while chat history is being fetched.
 */
export function MothershipChatSkeleton({
  layout = 'mothership-view',
}: MothershipChatSkeletonProps) {
  const styles = LAYOUT_SKELETON_STYLES[layout]

  return (
    <div className={styles.content}>
      <div className={styles.userRow}>
        <Skeleton className='h-[40px] w-[55%] rounded-[16px]' />
      </div>

      <div className='space-y-3'>
        <Skeleton className='h-[14px] w-[90%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[75%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[82%] rounded-[4px]' />
        <Skeleton className='h-[14px] w-[40%] rounded-[4px]' />
      </div>

      <div className={styles.userRow}>
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
