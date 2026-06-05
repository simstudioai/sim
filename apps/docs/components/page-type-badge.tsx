import type { DocsPageType } from '@/lib/source'
import { cn } from '@/lib/utils'

const CONFIG = {
  tutorial: { label: 'Tutorial', className: 'text-[#33c482] border-[#33c482]/30 bg-[#33c482]/10' },
  guide: {
    label: 'Guide',
    className: 'text-blue-600 border-blue-500/30 bg-blue-500/10 dark:text-blue-400',
  },
  reference: {
    label: 'Reference',
    className: 'text-violet-600 border-violet-500/30 bg-violet-500/10 dark:text-violet-400',
  },
  concept: {
    label: 'Concept',
    className: 'text-amber-600 border-amber-500/30 bg-amber-500/10 dark:text-amber-400',
  },
} as const satisfies Record<DocsPageType, { label: string; className: string }>

interface PageTypeBadgeProps {
  type: DocsPageType
  className?: string
}

/**
 * Small label that tells the reader which Diátaxis mode a page is — learning,
 * task, lookup, or understanding. Rendered only when a page declares `type`.
 */
export function PageTypeBadge({ type, className }: PageTypeBadgeProps) {
  const config = CONFIG[type]
  if (!config) return null

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-[11px] uppercase tracking-[0.04em]',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  )
}
