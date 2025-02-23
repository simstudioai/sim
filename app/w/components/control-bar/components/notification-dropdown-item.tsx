import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, Copy, Key, Terminal, X } from 'lucide-react'
import { ErrorIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import {
  NotificationOptions,
  NotificationStore,
  NotificationType,
} from '@/stores/notifications/types'

interface NotificationDropdownItemProps {
  id: string
  type: NotificationType
  message: string
  timestamp: number
  options?: NotificationOptions
}

const NotificationIcon = {
  error: ErrorIcon,
  console: Terminal,
  api: Key,
}

const NotificationColors = {
  error: 'text-destructive',
  console: 'text-foreground',
  api: 'text-green-500',
}

export function NotificationDropdownItem({
  id,
  type,
  message,
  timestamp,
  options,
}: NotificationDropdownItemProps) {
  const { removeNotification } = useNotificationStore()
  const Icon = NotificationIcon[type]
  const [, forceUpdate] = useState({})
  const [copied, setCopied] = useState(false)

  // Update the time display every minute
  useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 60000)
    return () => clearInterval(interval)
  }, [])

  const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true })

  const handleCopy = async () => {
    if (options?.copyableContent) {
      await navigator.clipboard.writeText(options.copyableContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <DropdownMenuItem
      className="flex items-start gap-2 p-3 cursor-default"
      onSelect={(e) => e.preventDefault()}
    >
      <Icon className={cn('h-4 w-4 mt-1', NotificationColors[type])} />
      <div className="flex flex-col gap-1 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">
              {type === 'error' ? 'Error' : type === 'api' ? 'API' : 'Console'}
            </span>
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>
          {options?.isPersistent && (
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 hover:bg-transparent hover:text-destructive"
              onClick={() => removeNotification(id)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap">{message}</p>
        {options?.copyableContent && (
          <div className="mt-2 relative">
            <pre className="bg-muted rounded-md p-2 text-xs font-mono">
              {options.copyableContent}
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-6 w-6 hover:bg-muted-foreground/20"
              onClick={handleCopy}
            >
              <Copy className="h-3 w-3" />
            </Button>
            {copied && (
              <span className="absolute top-2 right-9 text-xs text-muted-foreground">Copied!</span>
            )}
          </div>
        )}
      </div>
    </DropdownMenuItem>
  )
}
