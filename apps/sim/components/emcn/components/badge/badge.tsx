import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center px-[9px] py-[2.25px] text-[13px] font-medium gap-[4px] rounded-[40px] focus:outline-none transition-colors',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--surface-5)] text-[var(--text-secondary)] dark:bg-[var(--surface-5)] dark:text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:hover:text-[var(--text-primary)]',
        outline:
          'border border-[#575757] bg-transparent text-[var(--text-secondary)] dark:border-[#575757] dark:bg-transparent dark:text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:hover:text-[var(--text-primary)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
