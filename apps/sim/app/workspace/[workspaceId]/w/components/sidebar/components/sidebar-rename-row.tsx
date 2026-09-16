import type { ComponentPropsWithRef, ReactNode } from 'react'
import { chipVariants } from '@sim/emcn'

interface SidebarRenameRowProps
  extends Omit<ComponentPropsWithRef<'input'>, 'children' | 'className' | 'type'> {
  leadingAdornment?: ReactNode
}

/** Keeps inline renaming on the existing sidebar row instead of introducing a form field. */
export function SidebarRenameRow({
  leadingAdornment,
  onKeyDown,
  onClick,
  ...props
}: SidebarRenameRowProps) {
  return (
    <div className={chipVariants({ active: true, fullWidth: true })}>
      {leadingAdornment}
      <input
        type='text'
        className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-hidden focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
        maxLength={100}
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck={false}
        {...props}
        onKeyDown={(event) => {
          event.stopPropagation()
          onKeyDown?.(event)
        }}
        onClick={(event) => {
          event.stopPropagation()
          onClick?.(event)
        }}
      />
    </div>
  )
}
