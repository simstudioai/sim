import type { DocsPageType } from '@/lib/source'
import { cn } from '@/lib/utils'

/**
 * Status-color mapping mirrored from the emcn `Badge` variants
 * (`apps/sim/components/emcn/components/badge/badge.tsx`) — `green`, `blue`,
 * `purple`, and `amber` over the shared `--badge-*` tokens.
 */
const CONFIG = {
  tutorial: {
    label: 'Tutorial',
    className: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]',
  },
  guide: {
    label: 'Guide',
    className: 'bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]',
  },
  reference: {
    label: 'Reference',
    className: 'bg-[var(--badge-purple-bg)] text-[var(--badge-purple-text)]',
  },
  concept: {
    label: 'Concept',
    className: 'bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)]',
  },
} as const satisfies Record<DocsPageType, { label: string; className: string }>

interface PageTypeBadgeProps {
  type: DocsPageType
  className?: string
}

/**
 * Small label that tells the reader which Diátaxis mode a page is — learning,
 * task, lookup, or understanding. Rendered only when a page declares `type`.
 * Chrome matches the emcn `Badge` status variants (md size).
 */
export function PageTypeBadge({ type, className }: PageTypeBadgeProps) {
  const config = CONFIG[type]
  if (!config) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-[9px] py-0.5 font-medium font-season text-[12px] transition-colors',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  )
}
