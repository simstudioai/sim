import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import { Button, type ButtonProps } from '../button/button'

/** Transparent, bordered icon action over code or preview content. */
export const overlayActionButtonVariants = cva(
  'cursor-pointer border border-[var(--border)] bg-transparent p-0 backdrop-blur-xs hover-hover:bg-[var(--surface-3)] dark:hover-hover:bg-[var(--surface-5)] hover-hover:border-[var(--border)]',
  {
    variants: {
      size: {
        sm: 'size-[20px]',
        md: 'size-[28px]',
      },
    },
    defaultVariants: { size: 'sm' },
  }
)

export interface OverlayActionButtonProps
  extends Omit<ButtonProps, 'variant' | 'size' | 'iconPadding' | 'iconSize'> {
  /** Accessible name for the icon action; tooltip content is supplied separately. */
  'aria-label': string
  /** 20px by default; `md` provides the 28px preview action. */
  size?: NonNullable<VariantProps<typeof overlayActionButtonVariants>['size']>
}

/**
 * Icon action floating over content. Owns geometry, border, blur and hover treatment;
 * callers supply positioning, icons, labels and command behavior.
 * Hover uses surface-3 in light mode and surface-5 in dark mode.
 * Forwards the native button ref and props for tooltip `asChild` composition.
 * Native form behavior is inherited from Button; pass `type` when it must be explicit.
 *
 * @example <OverlayActionButton aria-label='Copy' type='button' onClick={onCopy}><Clipboard className='size-[10px]' /></OverlayActionButton>
 */
export const OverlayActionButton = forwardRef<HTMLButtonElement, OverlayActionButtonProps>(
  ({ size, className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant='ghost'
      size='md'
      className={cn(overlayActionButtonVariants({ size }), className)}
    />
  )
)

OverlayActionButton.displayName = 'OverlayActionButton'
