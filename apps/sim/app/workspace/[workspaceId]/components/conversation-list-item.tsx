import type { ReactNode } from 'react'
import { Blimp } from '@/components/emcn'
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
  isActive = false,
  isUnread = false,
  className,
  titleClassName,
  statusIndicatorClassName,
  actions,
}: ConversationListItemProps) {
  return (
    <div className={cn('flex w-full min-w-0 items-center gap-2', className)}>
      <span className='relative flex-shrink-0'>
        <Blimp className='h-[16px] w-[16px] text-[var(--text-icon)]' />
        {isActive && (
          <span
            className={cn(
              '-right-[1px] -bottom-[1px] absolute h-[6px] w-[6px] rounded-full border border-[var(--surface-1)] bg-amber-400',
              statusIndicatorClassName
            )}
          />
        )}
        {!isActive && isUnread && (
          <span
            className={cn(
              '-right-[1px] -bottom-[1px] absolute h-[6px] w-[6px] rounded-full border border-[var(--surface-1)] bg-[var(--indicator-online)]',
              statusIndicatorClassName
            )}
          />
        )}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', titleClassName)}>{title}</span>
      {actions && <div className='ml-auto flex flex-shrink-0 items-center'>{actions}</div>}
    </div>
  )
}
