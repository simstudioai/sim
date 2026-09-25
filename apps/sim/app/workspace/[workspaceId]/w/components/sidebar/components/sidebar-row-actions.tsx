import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn, mutedFocusRingClass } from '@sim/emcn'

interface SidebarRowActionProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> {
  'aria-label': string
}

/** The compact action within a sidebar row; callers retain icons and menu event handling. */
export const SidebarRowAction = forwardRef<HTMLButtonElement, SidebarRowActionProps>(
  (props, ref) => (
    <button
      {...props}
      ref={ref}
      type='button'
      className={cn('flex size-[18px] items-center justify-center rounded-sm', mutedFocusRingClass)}
    />
  )
)

SidebarRowAction.displayName = 'SidebarRowAction'
