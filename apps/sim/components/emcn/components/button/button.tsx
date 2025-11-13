import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 outline-none focus:outline-none focus-visible:outline-none rounded-[4px] px-[8px] py-[6px] text-[12px]',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--surface-5)] dark:bg-[var(--surface-5)] hover:bg-[var(--surface-9)] dark:hover:bg-[var(--surface-9)]',
        active:
          'bg-[var(--surface-9)] dark:bg-[var(--surface-9)] hover:bg-[var(--surface-11)] dark:hover:bg-[var(--surface-11)] dark:text-[var(--text-primary)] text-[var(--text-primary)]',
        '3d': 'dark:text-[var(--text-tertiary)] border-t border-l border-r dark:border-[var(--border-strong)] shadow-[0_2px_0_0] dark:shadow-[var(--border-strong)] hover:shadow-[0_4px_0_0] transition-all hover:-translate-y-0.5 hover:dark:text-[var(--text-primary)]',
        outline:
          'border border-[#727272] bg-[var(--border-strong)] hover:bg-[var(--surface-11)] dark:border-[#727272] dark:bg-[var(--border-strong)] dark:hover:bg-[var(--surface-11)]',
        primary:
          'bg-[var(--brand-400)] dark:bg-[var(--brand-400)] dark:text-[var(--text-primary)] text-[var(--text-primary)] hover:brightness-110 hover:text-[var(--text-primary)] hover:dark:text-[var(--text-primary)]',
        secondary:
          'bg-[var(--brand-secondary)] dark:bg-[var(--brand-secondary)] dark:text-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--brand-secondary)] hover:dark:bg-[var(--brand-secondary)] hover:text-[var(--text-primary)] hover:dark:text-[var(--text-primary)]',
        tertiary:
          'bg-[var(--brand-tertiary)] dark:bg-[var(--brand-tertiary)] dark:text-[var(--text-primary)] text-[var(--text-primary)] hover:bg-[var(--brand-tertiary)] hover:dark:bg-[var(--brand-tertiary)] hover:text-[var(--text-primary)] hover:dark:text-[var(--text-primary)]',
        ghost: '',
        'ghost-secondary': 'text-[var(--text-muted)] dark:text-[var(--text-muted)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />
}

export { Button, buttonVariants }
