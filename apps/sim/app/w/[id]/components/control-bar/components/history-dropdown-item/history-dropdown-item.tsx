import { formatDistanceToNow } from 'date-fns'
import { Clock } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface HistoryDropdownItemProps {
  action: string
  timestamp: number
  onClick?: () => void
  isCurrent?: boolean
  isFuture?: boolean
  id?: string
}

export function HistoryDropdownItem({
  action,
  timestamp,
  onClick,
  isCurrent = false,
  isFuture = false,
  id,
}: HistoryDropdownItemProps) {
  const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true })

  return (
    <DropdownMenuItem
      className={cn(
        'flex items-start gap-2 p-3 cursor-pointer',
        isFuture && 'text-muted-foreground/50'
      )}
      onClick={onClick}
    >
      <Clock
        className={cn('h-4 w-4', isFuture ? 'text-muted-foreground/50' : 'text-muted-foreground')}
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {isCurrent ? (
            <span
              className={cn(
                'text-xs',
                isFuture ? 'text-muted-foreground/50' : 'text-muted-foreground'
              )}
            >
              Current
            </span>
          ) : (
            <span
              className={cn(
                'text-xs',
                isFuture ? 'text-muted-foreground/50' : 'text-muted-foreground'
              )}
            >
              {timeAgo}
            </span>
          )}
        </div>
        <p className={cn('text-sm', isFuture ? 'text-muted-foreground/50' : 'text-foreground')}>
          {action}
        </p>
      </div>
    </DropdownMenuItem>
  )
}
