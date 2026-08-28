import type { ReactNode } from 'react'
import { cn, OverflowText } from '@sim/emcn'

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
  isActive = false,
  isUnread = false,
  className,
  titleClassName,
  statusIndicatorClassName,
  actions,
}: ConversationListItemProps) {
  const showStatusDot = isActive || isUnread
  return (
    <div className={cn('flex w-full min-w-0 items-center gap-2', className)}>
      <OverflowText label={title} className={cn('flex-1', titleClassName)} />
      {showStatusDot && (
        <span
          aria-hidden='true'
          className={cn('size-[6px] flex-shrink-0 rounded-full', statusIndicatorClassName)}
          style={{
            backgroundColor: isActive ? '#EAB308' : 'var(--brand-accent)',
          }}
        />
      )}
      {actions && <div className='ml-auto flex flex-shrink-0 items-center'>{actions}</div>}
    </div>
  )
}
