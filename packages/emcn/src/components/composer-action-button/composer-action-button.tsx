import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import { Button, type ButtonProps } from '../button/button'

/** Shared circular send, stop and search appearance, including the compact chat treatment. */
export const composerActionButtonVariants = cva('rounded-full p-0', {
  variants: {
    size: {
      sm: 'size-[22px]',
      md: 'size-[28px] border-0',
    },
    active: {
      true: 'bg-[#383838] dark:bg-[#E0E0E0]',
      false: 'bg-[#808080] dark:bg-[#808080]',
    },
  },
  compoundVariants: [
    { size: 'md', active: true, className: 'hover:bg-[#575757] dark:hover:bg-[#CFCFCF]' },
    {
      size: 'sm',
      active: true,
      className: 'hover-hover:bg-[#575757] dark:hover-hover:bg-[#CFCFCF]',
    },
  ],
  defaultVariants: { size: 'md', active: true },
})

export interface ComposerActionButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
  /** Accessible name for the caller's icon action. */
  'aria-label': string
  /** 28px by default; `sm` retains compact chat's 22px geometry and hover treatment. */
  size?: NonNullable<VariantProps<typeof composerActionButtonVariants>['size']>
  /**
   * Whether to show the active fill. Independent of `disabled`: a populated composer
   * can retain its active appearance while execution temporarily prevents submission.
   * @default true
   */
  active?: boolean
}

/**
 * Circular action at the end of a composer or search field. Owns the button appearance;
 * callers retain icons, labels, handlers and submission/streaming conditions.
 * Forwards the native button ref and props, including Button's native form behavior.
 *
 * @example <ComposerActionButton aria-label='Send' active={canSubmit} disabled={!canSubmit} onClick={onSend}><ArrowUp className='size-[16px] text-white dark:text-black' /></ComposerActionButton>
 */
export const ComposerActionButton = forwardRef<HTMLButtonElement, ComposerActionButtonProps>(
  ({ size, active, className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant='ghost'
      size='md'
      className={cn(composerActionButtonVariants({ size, active }), className)}
    />
  )
)

ComposerActionButton.displayName = 'ComposerActionButton'
