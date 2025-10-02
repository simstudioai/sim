import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 outline-none focus:outline-none focus-visible:outline-none rounded-[4px] px-[8px] py-[6px]',
  {
    variants: {
      variant: {
        default: 'rounded',
        '3d': 'dark:text-[#AEAEAE] border-t border-l border-r dark:border-[#303030] shadow-[0_2px_0_0] dark:shadow-[#303030] hover:shadow-[0_4px_0_0] transition-all hover:-translate-y-0.5 hover:dark:text-[#E6E6E6]',
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
