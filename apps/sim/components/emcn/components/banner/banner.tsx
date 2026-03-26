'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Button, type ButtonProps } from '@/components/emcn/components/button/button'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Banner component.
 *
 * @remarks
 * Supports semantic variants:
 * - **default** - Neutral surface background for informational banners
 * - **destructive** - Red background for error/danger messages
 * - **warning** - Amber/orange background for caution messages
 * - **info** - Blue background for informational highlights
 * - **success** - Green background for positive confirmations
 */
// TODO: Replace raw Tailwind palette colors with semantic tokens once
// muted banner background tokens (e.g. --banner-destructive-bg) are added to globals.css.
const bannerVariants = cva('shrink-0 px-6 py-2.5', {
  variants: {
    variant: {
      default: 'bg-[var(--surface-active)]',
      destructive: 'bg-red-50 dark:bg-red-950/30',
      warning: 'bg-amber-50 dark:bg-amber-950/30',
      info: 'bg-blue-50 dark:bg-blue-950/30',
      success: 'bg-green-50 dark:bg-green-950/30',
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
            'mx-auto flex max-w-[1400px] items-center justify-between gap-3',
            contentClassName
          )}
        >
          <p className={cn('text-[13px]', textClassName)}>{text}</p>
          {actionLabel ? (
            <Button
              variant={actionVariant}
              className={cn('h-[28px] shrink-0 px-2 text-[12px]', actionClassName)}
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
