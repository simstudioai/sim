import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import styles from './shimmer-text.module.css'

export type ShimmerTextProps<T extends ElementType = 'span'> = {
  as?: T
  children: ReactNode
  className?: string
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>

/**
 * Sweeping-highlight shimmer for active text. Size and weight come from the
 * consumer; `--shimmer-rest` supplies resting ink under reduced motion.
 *
 * @example
 * <ShimmerText className='text-sm'>Working…</ShimmerText>
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
