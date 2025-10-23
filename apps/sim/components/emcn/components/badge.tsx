import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center px-[9px] py-[2.25px] text-[13px] font-medium gap-[4px] rounded-[40px] focus:outline-none transition-colors',
  {
    variants: {
      variant: {
        default:
          'bg-[#272727] text-[#B1B1B1] dark:bg-[#272727] dark:text-[#B1B1B1] hover:text-[#E6E6E6] dark:hover:text-[#E6E6E6]',
        outline:
          'border border-[#575757] bg-transparent text-[#B1B1B1] dark:border-[#575757] dark:bg-transparent dark:text-[#B1B1B1] hover:text-[#E6E6E6] dark:hover:text-[#E6E6E6]',
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
