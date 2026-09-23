import { type ComponentProps, forwardRef } from 'react'
import { Button, cn } from '@sim/emcn'

interface BrowserToolbarButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    'variant' | 'size' | 'iconSize' | 'iconPadding' | 'type'
  > {
  'aria-label': string
}

/** Browser navigation and utility action; forwards menu-anchor refs and native events. */
export const BrowserToolbarButton = forwardRef<HTMLButtonElement, BrowserToolbarButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      type='button'
      variant='ghost-secondary'
      size='sm'
      iconSize='regular'
      className={cn('shrink-0', className)}
    />
  )
)

BrowserToolbarButton.displayName = 'BrowserToolbarButton'
