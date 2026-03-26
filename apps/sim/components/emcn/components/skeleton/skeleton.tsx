import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Skeleton component.
 *
 * @remarks
 * Supports shape variants for different placeholder types:
 * - **line** - Rounded rectangle for text lines (default)
 * - **circle** - Perfect circle for avatars and icons
 * - **rectangle** - Sharp-cornered rectangle for images and cards
 */
const skeletonVariants = cva(
  'animate-pulse bg-[var(--surface-active)] motion-reduce:animate-none',
  {
    variants: {
      variant: {
        line: 'rounded-md',
        circle: 'rounded-full',
        rectangle: 'rounded-sm',
      },
    },
    defaultVariants: {
      variant: 'line',
    },
  }
)

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {}

/**
 * Placeholder loading skeleton with a subtle pulse animation.
 *
 * @example
 * ```tsx
 * // Text line skeleton
 * <Skeleton className="h-4 w-48" />
 *
 * // Avatar skeleton
 * <Skeleton variant="circle" className="h-8 w-8" />
 *
 * // Image skeleton
 * <Skeleton variant="rectangle" className="h-32 w-full" />
 * ```
 */
function Skeleton({ className, variant, ...props }: SkeletonProps) {
  return <div className={cn(skeletonVariants({ variant }), className)} {...props} />
}

export { Skeleton, skeletonVariants }
