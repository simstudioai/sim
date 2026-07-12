import { cn } from '@sim/emcn'
import styles from '@/components/ui/shimmer-text.module.css'

interface ShimmerTextProps {
  children: React.ReactNode
  className?: string
}

/**
 * Sweeping-highlight shimmer over a text phrase — the same treatment as the
 * ThinkingLoader's "Thinking…" label, reusable on any active/streaming row.
 * Size and weight come from the consumer's className; the gradient replaces
 * the text color, so color classes are ignored while shimmering.
 */
export function ShimmerText({ children, className }: ShimmerTextProps) {
  return <span className={cn(styles.shimmer, className)}>{children}</span>
}
