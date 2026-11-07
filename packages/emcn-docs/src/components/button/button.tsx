import type { ComponentProps } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { docsControlClass } from '#docs/components/chrome/chrome'

interface DocsButtonProps extends ComponentProps<'button'> {
  iconOnly?: boolean
}

/** Shared control geometry scoped to documentation. */
export function DocsButton({ className, iconOnly, type = 'button', ...props }: DocsButtonProps) {
  return (
    <button
      type={type}
      className={cn(docsControlClass, iconOnly && 'size-7 rounded-full p-0', className)}
      {...props}
    />
  )
}
