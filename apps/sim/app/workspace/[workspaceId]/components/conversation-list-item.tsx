import type { ReactNode } from 'react'
import { cn } from '@/lib/core/utils/cn'

interface ConversationListItemProps {
  title: string
  isActive?: boolean
  isUnread?: boolean
  className?: string
  titleClassName?: string
  statusIndicatorClassName?: string
  actions?: ReactNode
}

export function ConversationListItem({
  title,
  className,
  titleClassName,
  actions,
}: ConversationListItemProps) {
  return (
    <div className={cn('flex w-full min-w-0 items-center gap-2', className)}>
      <span className={cn('min-w-0 flex-1 truncate', titleClassName)}>{title}</span>
      {actions && <div className='ml-auto flex flex-shrink-0 items-center'>{actions}</div>}
    </div>
  )
}
