import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-70 outline-none focus:outline-none focus-visible:outline-none rounded-[5px]',
  {
    variants: {
      variant: {
        default:
          'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)] bg-[var(--surface-4)] hover-hover:bg-[var(--surface-6)] border border-[var(--border)] hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]',
        active:
          'bg-[var(--surface-5)] hover-hover:bg-[var(--surface-6)] text-[var(--text-primary)] hover-hover:text-[var(--text-primary)] border border-[var(--border-1)] hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--border-1)]',
        '3d': 'text-[var(--text-tertiary)] border-t border-l border-r border-[var(--border-1)] shadow-[0_2px_0_0_var(--border-1)] hover-hover:shadow-[0_4px_0_0_var(--border-1)] transition-[transform,box-shadow,color] hover-hover:-translate-y-0.5 hover-hover:text-[var(--text-primary)]',
        outline:
          'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)] border border-[var(--text-muted)] bg-transparent hover-hover:border-[var(--text-secondary)]',
        primary:
          'bg-[var(--text-primary)] text-[var(--text-inverse)] hover-hover:text-[var(--text-inverse)] hover-hover:bg-[var(--text-body)] dark:bg-white dark:text-[var(--bg)] dark:hover-hover:bg-[var(--text-secondary)] dark:hover-hover:text-[var(--bg)]',
        destructive:
          'bg-[var(--text-error)] text-white hover-hover:text-white hover-hover:brightness-106',
        secondary: 'bg-[var(--brand-secondary)] text-[var(--text-primary)]',
        tertiary:
          'bg-[var(--brand-accent)] text-[var(--text-inverse)] hover-hover:text-[var(--text-inverse)] hover-hover:bg-[var(--brand-accent-hover)] dark:bg-[var(--brand-accent)] dark:hover-hover:bg-[var(--brand-accent-hover)] dark:text-[var(--text-inverse)] dark:hover-hover:text-[var(--text-inverse)]',
        ghost: 'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)]',
        subtle:
          'text-[var(--text-body)] hover-hover:text-[var(--text-body)] hover-hover:bg-[var(--surface-4)]',
        'ghost-secondary': 'text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]',
      },
      size: {
        sm: 'px-1.5 py-1 text-[length:11px]',
        md: 'px-2 py-1.5 text-[length:12px]',
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
