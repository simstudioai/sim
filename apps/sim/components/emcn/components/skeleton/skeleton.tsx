import { cn } from '@/lib/core/utils/cn'

/**
 * Placeholder loading skeleton with a subtle pulse animation.
 * @param props - Standard div attributes including className for sizing.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--surface-active)]', className)}
      {...props}
    />
  )
}

export { Skeleton }
