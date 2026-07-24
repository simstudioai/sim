import type { ComponentPropsWithoutRef, ElementType } from 'react'
import { cn } from '@sim/emcn'
import styles from '@/components/ui/shimmer-text.module.css'

type ShimmerTextProps<T extends ElementType = 'span'> = {
  as?: T
  children: React.ReactNode
  className?: string
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>

/**
 * Sweeping-highlight shimmer over a text phrase — the same treatment as the
 * ThinkingLoader's "Thinking…" label, reusable on any active/streaming row.
 * Size and weight come from the consumer's className; the gradient replaces
 * the text color, so color classes are ignored while shimmering.
 */
export function ShimmerText<T extends ElementType = 'span'>({
  as,
  children,
  className,
  ...props
}: ShimmerTextProps<T>) {
  const Comp = as ?? 'span'
  return (
    <Comp className={cn(styles.shimmer, className)} {...props}>
      {children}
    </Comp>
  )
}
