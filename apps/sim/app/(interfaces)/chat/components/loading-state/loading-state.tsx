import { Skeleton } from '@sim/emcn'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'

export function ChatLoadingState() {
  return (
    <div className='light desktop-title-bar-page fixed inset-0 z-[var(--z-dropdown)] flex flex-col bg-[var(--bg)]'>
      <DesktopTitleBarLane />
      <div className='flex flex-1 items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            {/* Title skeleton */}
            <div className='space-y-2 text-center'>
              <Skeleton className='mx-auto h-8 w-32' />
              <Skeleton className='mx-auto h-4 w-48' />
            </div>

            {/* Chat skeleton */}
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
    </div>
  )
}
