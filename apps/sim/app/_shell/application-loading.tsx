import { cn, SimWordmark } from '@sim/emcn'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'

interface ApplicationLoadingProps {
  fullScreen?: boolean
}

/** Shared loading surface for app entry, shell prefetch, and workflow navigation. */
export function ApplicationLoading({ fullScreen = true }: ApplicationLoadingProps) {
  return (
    <div
      role='status'
      aria-label='Loading Sim'
      className={cn(
        'flex w-full items-center justify-center bg-[var(--bg)]',
        fullScreen ? 'desktop-title-bar-page' : 'h-full'
      )}
    >
      {fullScreen && <DesktopTitleBarLane />}
      <SimWordmark size='loading' tone='brand-muted' />
    </div>
  )
}
