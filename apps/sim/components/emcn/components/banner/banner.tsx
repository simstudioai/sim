'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

const bannerVariants = cva('shrink-0 px-[24px] py-[10px]', {
  variants: {
    variant: {
      default: 'bg-[var(--surface-active)]',
      destructive: 'bg-red-50 dark:bg-red-950/30',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export interface BannerProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bannerVariants> {
  children: ReactNode
}

export function Banner({ className, variant, children, ...props }: BannerProps) {
  return (
    <div className={cn(bannerVariants({ variant }), className)} {...props}>
      {children}
    </div>
  )
}
