import { forwardRef } from 'react'
import { cn } from '../../lib/cn'
import { Button, type ButtonProps } from '../button/button'
import { chipFilledFillTokens, chipRadiusClass } from '../chip/chip-chrome'

/** The shared 28px geometry and brand-hover treatment of selection action bars. */
const BULK_ACTION_BUTTON_CLASS = `${chipRadiusClass} ${chipFilledFillTokens} size-[28px] p-0 hover-hover:bg-[var(--brand-secondary)] hover-hover:text-[var(--text-inverse)]!`

export interface BulkActionButtonProps
  extends Omit<ButtonProps, 'variant' | 'size' | 'iconPadding' | 'iconSize'> {
  /** Accessible name for the icon action; tooltip content is supplied separately. */
  'aria-label': string
}

/**
 * Icon action for a selection's bulk-action bar. Owns its geometry and visual states;
 * callers provide icon content, labels, disabled state and command behavior.
 * Forwards the native button ref and props for tooltip/menu `asChild` composition.
 * Native form behavior is inherited from Button; pass `type` when it must be explicit.
 *
 * @example <BulkActionButton aria-label='Delete' onClick={onDelete}><Trash className='size-[12px]' /></BulkActionButton>
 */
export const BulkActionButton = forwardRef<HTMLButtonElement, BulkActionButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant='ghost'
      size='md'
      className={cn(BULK_ACTION_BUTTON_CLASS, className)}
    />
  )
)

BulkActionButton.displayName = 'BulkActionButton'
