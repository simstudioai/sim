import { cn } from '@sim/emcn'
import { RefreshCw } from '@sim/emcn/icons'
import type { ResourceAction } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'

interface RefreshIconProps {
  className?: string
}

function SpinningRefreshIcon(props: RefreshIconProps) {
  return <RefreshCw {...props} animate />
}

function NewLogsIndicator({ className }: RefreshIconProps) {
  return (
    <span className={cn(className, 'inline-flex items-center justify-center')} aria-hidden='true'>
      <span className='size-1.5 rounded-full bg-[var(--brand-blue)]' />
    </span>
  )
}

interface LogsRefreshActionOptions {
  newLogCount: number
  hasUpdates?: boolean
  isRefreshing: boolean
  onRefresh: () => void
}

export function getLogsRefreshAction({
  newLogCount,
  hasUpdates = false,
  isRefreshing,
  onRefresh,
}: LogsRefreshActionOptions): ResourceAction {
  const hasNewLogs = newLogCount > 0
  return {
    id: 'refresh',
    text: hasNewLogs
      ? `${newLogCount} new ${newLogCount === 1 ? 'log' : 'logs'}`
      : hasUpdates
        ? 'Updates available'
        : 'Refresh',
    tooltip: hasNewLogs
      ? 'Refresh to see new logs'
      : hasUpdates
        ? 'Refresh to see updated logs'
        : 'Refresh',
    icon: isRefreshing
      ? SpinningRefreshIcon
      : hasNewLogs || hasUpdates
        ? NewLogsIndicator
        : RefreshCw,
    onSelect: onRefresh,
    disabled: isRefreshing,
  }
}
