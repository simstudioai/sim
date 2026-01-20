import { PopoverSection } from '@/components/emcn'

/**
 * Skeleton loading component for chat history dropdown
 * Displays placeholder content while chats are being loaded
 */
export function ChatHistorySkeleton() {
  return (
    <>
      <PopoverSection>
        <div className='h-3 w-12 animate-pulse rounded bg-muted/40' />
      </PopoverSection>
      <div className='flex flex-col gap-0.5'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='flex h-[25px] items-center px-[6px]'>
            <div className='h-3 w-full animate-pulse rounded bg-muted/40' />
          </div>
        ))}
      </div>
    </>
  )
}
