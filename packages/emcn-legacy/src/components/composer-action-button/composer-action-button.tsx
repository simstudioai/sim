import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import { Button, type ButtonProps } from '../button/button'

/** Shared circular send, stop and search appearance, including the compact chat treatment. */
const composerActionButtonVariants = cva(
  'flex shrink-0 items-center justify-center rounded-full transition-colors',
  {
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
      {
        size: 'md',
        active: true,
        className:
          'group-hover/composer-action:bg-[#575757] dark:group-hover/composer-action:bg-[#CFCFCF]',
      },
      {
        size: 'sm',
        active: true,
        className:
          '[@media(hover:hover)]:group-hover/composer-action:bg-[#575757] dark:[@media(hover:hover)]:group-hover/composer-action:bg-[#CFCFCF]',
      },
    ],
    defaultVariants: { size: 'md', active: true },
  }
)

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
 * The visible circle keeps its size when a touch layout enlarges the hit target.
 * Forwards the native button ref and props, including Button's native form behavior.
 *
 * @example <ComposerActionButton aria-label='Send' active={canSubmit} disabled={!canSubmit} onClick={onSend}><ArrowUp className='size-[16px] text-white dark:text-black' /></ComposerActionButton>
 */
export const ComposerActionButton = forwardRef<HTMLButtonElement, ComposerActionButtonProps>(
  ({ size, active, className, children, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant='ghost'
      size='md'
      className={cn(
        'group/composer-action size-auto shrink-0 rounded-full border-0 p-0 max-md:pointer-coarse:min-h-11 max-md:pointer-coarse:min-w-11',
        className
      )}
    >
      <span className={composerActionButtonVariants({ size, active })}>{children}</span>
    </Button>
  )
)

ComposerActionButton.displayName = 'ComposerActionButton'
