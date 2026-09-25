import type { ReactNode, Ref } from 'react'
import { cn } from '../../lib/cn'

export const rowActionsGroupClass = 'group/row-actions'

export interface RowActionsProps {
  children: ReactNode
  indicator?: ReactNode
  open?: boolean
  revealOnHover?: boolean
  size?: 'sm' | 'md'
  /** Layout and positioning only. */
  className?: string
  /** The action layer, for composite controls that move focus into it. */
  actionRef?: Ref<HTMLDivElement>
}

/**
 * Reclaims idle action space and overlays actions on an indicator when the row
 * is hovered or focused. Touch layouts keep both visible side by side. Place
 * {@link rowActionsGroupClass} on the interactive row that owns this slot.
 */
export function RowActions({
  children,
  indicator,
  open = false,
  revealOnHover = true,
  size = 'sm',
  className,
  actionRef,
}: RowActionsProps) {
  const sizeClass = size === 'sm' ? 'size-[18px]' : 'size-[24px]'

  return (
    <div
      data-row-actions=''
      className={cn(
        'pointer-events-none relative shrink-0 items-center justify-center gap-1.5 [@media(any-pointer:coarse)]:w-auto [@media(hover:none)]:w-auto',
        sizeClass,
        indicator || open ? 'flex' : 'hidden',
        revealOnHover &&
          'group-focus-within/row-actions:flex group-hover/row-actions:flex [@media(any-pointer:coarse)]:flex [@media(hover:none)]:flex',
        className
      )}
    >
      {indicator && (
        <span
          data-row-action-indicator=''
          className={cn(
            'pointer-events-none flex shrink-0 items-center justify-center transition-opacity [@media(any-pointer:coarse)]:opacity-100!',
            sizeClass,
            open && '[@media(hover:hover)]:opacity-0',
            revealOnHover &&
              '[@media(hover:hover)]:group-focus-within/row-actions:opacity-0 [@media(hover:hover)]:group-hover/row-actions:opacity-0'
          )}
        >
          {indicator}
        </span>
      )}
      <div
        ref={actionRef}
        data-row-action-controls=''
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity [@media(any-pointer:coarse)]:static [@media(hover:none)]:static',
          open && 'pointer-events-auto opacity-100',
          revealOnHover &&
            'group-focus-within/row-actions:pointer-events-auto group-focus-within/row-actions:opacity-100 group-hover/row-actions:pointer-events-auto group-hover/row-actions:opacity-100 [@media(any-pointer:coarse)]:pointer-events-auto [@media(any-pointer:coarse)]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100'
        )}
      >
        {children}
      </div>
    </div>
  )
}
