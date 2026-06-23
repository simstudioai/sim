import { cn } from '@/lib/core/utils/cn'

export interface IsoBuildIllustrationProps {
  size?: number
  className?: string
}

/**
 * Static supplied illustration for the Build area.
 */
export function IsoBuildIllustration({ size = 166, className }: IsoBuildIllustrationProps) {
  return (
    <img
      src='/landing/sim-feature-illo-4.svg?v=2'
      alt='Build illustration'
      width={size}
      height={size}
      draggable={false}
      className={cn('block max-w-none', className)}
    />
  )
}
