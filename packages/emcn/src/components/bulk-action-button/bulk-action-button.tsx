import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import { Button, type ButtonProps } from '../button/button'
import { chipFilledFillTokens, chipRadiusClass } from '../chip/chip-chrome'

/** The shared 28px geometry and brand-hover treatment of selection action bars. */
export const bulkActionButtonVariants = cva(
  `${chipRadiusClass} size-[28px] p-0 hover-hover:bg-[var(--brand-secondary)] hover-hover:text-[var(--text-inverse)]!`,
  {
    variants: {
      surface: {
        adaptive: chipFilledFillTokens,
        uniform: 'bg-[var(--surface-5)]',
      },
    },
    defaultVariants: { surface: 'adaptive' },
  }
)

export interface BulkActionButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
  /** Accessible name for the icon action; tooltip content is supplied separately. */
  'aria-label': string
  /**
   * `adaptive` follows the filled chip surface: surface-5 in light mode and surface-4 in dark.
   * `uniform` retains surface-5 in both themes, as used by table-cell action bars.
   * @default 'adaptive'
   */
  surface?: NonNullable<VariantProps<typeof bulkActionButtonVariants>['surface']>
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
  ({ surface, className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant='ghost'
      size='md'
      className={cn(bulkActionButtonVariants({ surface }), className)}
    />
  )
)

BulkActionButton.displayName = 'BulkActionButton'
