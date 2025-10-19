import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center px-[9px] py-[2.5px] text-[13px] font-medium rounded-[40px] focus:outline-none',
  {
    variants: {
      variant: {
        default: 'bg-[#272727] text-[#B1B1B1] dark:bg-[#272727] dark:text-[#B1B1B1]',
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
