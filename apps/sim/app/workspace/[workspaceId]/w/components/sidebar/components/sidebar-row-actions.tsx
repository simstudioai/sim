import { type ButtonHTMLAttributes, forwardRef } from 'react'

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
      className='flex size-[18px] items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)]'
    />
  )
)

SidebarRowAction.displayName = 'SidebarRowAction'
