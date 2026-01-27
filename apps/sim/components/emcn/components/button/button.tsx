import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

const buttonVariants = cva(
  'inline-flex items-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-70 outline-none focus:outline-none focus-visible:outline-none rounded-[5px]',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--surface-4)] hover:bg-[var(--surface-6)] border border-[var(--border)] hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]',
        active:
          'bg-[var(--surface-5)] hover:bg-[var(--surface-7)] text-[var(--text-primary)] border border-[var(--border-1)] dark:hover:bg-[var(--border-1)]',
        '3d': 'text-[var(--text-tertiary)] border-t border-l border-r border-[var(--border-1)] shadow-[0_2px_0_0_var(--border-1)] hover:shadow-[0_4px_0_0_var(--border-1)] transition-all hover:-translate-y-0.5 hover:text-[var(--text-primary)]',
        outline:
          'border border-[var(--text-muted)] bg-transparent hover:border-[var(--text-secondary)]',
        primary: 'bg-[var(--brand-400)] text-[var(--text-primary)] hover:brightness-106',
        destructive: 'bg-[var(--text-error)] text-white hover:text-white hover:brightness-106',
        secondary: 'bg-[var(--brand-secondary)] text-[var(--text-primary)]',
        tertiary:
          '!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:brightness-106 hover:!text-[var(--text-inverse)] ![transition-property:background-color,border-color,fill,stroke]',
        ghost: '',
        'ghost-secondary': 'text-[var(--text-muted)]',
        /** Branded button - requires branded-button-gradient or branded-button-custom class for colors */
        branded:
          'rounded-[10px] border text-white hover:text-white text-[15px] transition-all duration-200',
      },
      size: {
        sm: 'px-[6px] py-[4px] text-[11px]',
        md: 'px-[8px] py-[6px] text-[12px]',
        /** Branded size - matches login form button padding */
        branded: 'py-[6px] pr-[10px] pl-[12px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    )
  }
)

Button.displayName = 'Button'

export { Button, buttonVariants }
