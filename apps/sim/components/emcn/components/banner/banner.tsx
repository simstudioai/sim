'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Button, type ButtonProps } from '@/components/emcn/components/button/button'
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
  actionClassName?: string
  actionDisabled?: boolean
  actionLabel?: ReactNode
  actionProps?: Omit<ButtonProps, 'children' | 'className' | 'disabled' | 'onClick' | 'variant'>
  actionVariant?: ButtonProps['variant']
  children?: ReactNode
  contentClassName?: string
  onAction?: () => void
  text?: ReactNode
  textClassName?: string
}

export function Banner({
  actionClassName,
  actionDisabled,
  actionLabel,
  actionProps,
  actionVariant = 'default',
  children,
  className,
  contentClassName,
  onAction,
  text,
  textClassName,
  variant,
  ...props
}: BannerProps) {
  return (
    <div className={cn(bannerVariants({ variant }), className)} {...props}>
      {children ?? (
        <div
          className={cn(
            'mx-auto flex max-w-[1400px] items-center justify-between gap-[12px]',
            contentClassName
          )}
        >
          <p className={cn('text-[13px]', textClassName)}>{text}</p>
          {actionLabel ? (
            <Button
              variant={actionVariant}
              className={cn('h-[28px] shrink-0 px-[8px] text-[12px]', actionClassName)}
              onClick={onAction}
              disabled={actionDisabled}
              {...actionProps}
            >
              {actionLabel}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
