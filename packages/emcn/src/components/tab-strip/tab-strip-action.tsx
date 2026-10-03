import { forwardRef } from 'react'
import { cn } from '../../lib/cn'
import { Button, type ButtonProps } from '../button/button'

export interface TabStripActionProps
  extends Omit<ButtonProps, 'size' | 'iconSize' | 'iconPadding'> {
  /** Accessible name for the icon action. */
  'aria-label': string
  /** Keeps the Button text scale without applying its separate icon geometry. */
  size?: Exclude<ButtonProps['size'], 'icon'>
}

/**
 * Icon action sized to its tab strip's control band, defaulting to 30px.
 * Callers retain the Button variant, icon, tooltip and action behavior.
 *
 * @example <TabStripAction variant='subtle' aria-label='Export' onClick={onExport}><Download /></TabStripAction>
 */
export const TabStripAction = forwardRef<HTMLButtonElement, TabStripActionProps>(
  ({ className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      className={cn('size-[var(--tab-strip-band,30px)] shrink-0 p-0', className)}
    />
  )
)

TabStripAction.displayName = 'TabStripAction'
