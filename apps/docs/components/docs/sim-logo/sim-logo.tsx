import { Wordmark } from '@sim/emcn/brand/wordmark'
import { cn } from '@sim/emcn/lib/cn'

interface SimLogoProps {
  className?: string
}

/** Canonical wordmark sized for documentation navigation. */
export function SimWordmark({ className }: SimLogoProps) {
  return (
    <Wordmark
      width={40}
      height={(40 * 212) / 441}
      className={cn('-translate-y-0.5 block h-auto w-10 overflow-visible', className)}
    />
  )
}
