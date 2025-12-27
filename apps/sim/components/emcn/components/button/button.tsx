import type * as React from 'react'
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
          'border border-[var(--text-muted)] bg-[var(--surface-4)] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
        primary: 'bg-[var(--brand-400)] text-[var(--text-primary)] hover:brightness-110',
        destructive: 'bg-[var(--text-error)] text-white hover:text-white hover:brightness-110',
        secondary: 'bg-[var(--brand-secondary)] text-[var(--text-primary)]',
        tertiary:
          '!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:brightness-110 hover:!text-[var(--text-inverse)] ![transition-property:background-color,border-color,fill,stroke]',
        ghost: '',
        'ghost-secondary': 'text-[var(--text-muted)]',
      },
      size: {
        sm: 'px-[6px] py-[4px] text-[11px]',
        md: 'px-[8px] py-[6px] text-[12px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button, buttonVariants }
