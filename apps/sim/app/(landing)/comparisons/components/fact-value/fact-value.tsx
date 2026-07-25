import { Check, X } from '@sim/emcn/icons'
import type { Fact } from '@/lib/compare/data'
import { SourceLink } from '@/app/(landing)/comparisons/components/source-info'
import { parseFactValue } from '@/app/(landing)/comparisons/fact-status'

export interface FactValueProps {
  fact: Fact
}

/**
 * Renders one {@link Fact} for a glancing reader while keeping the full
 * granular fact server-rendered for crawlers and AI answer engines.
 *
 * - A true "Yes"/"No" fact renders as an icon alone (a monochrome check or
 *   muted cross, no colored pass/fail styling), no visible text, since the
 *   label column and surrounding context already say what's being asked.
 * - Any other fact shows its `shortValue` (a compact, pre-authored
 *   restatement of `value`), never the full sentence.
 * - `Tooltip` here is a cursor-following mini-bubble meant for a short
 *   one-line label (see its own docs/usages: "Refresh", "last updated: X")
 *  . It is deliberately NOT used to hold paragraph-length detail text, only
 *   the compact source citation, which is exactly what it's designed for.
 * - When a source exists, the visible glance (icon or `shortValue` text)
 *   IS the hover/click target for that source, via `SourceLink`, rather
 *   than a separate info-icon next to every value. One affordance per
 *   fact keeps a 58-row table from reading as icon-cluttered.
 * - A `sr-only` span always carries the complete value, detail, and source
 *   in the initial server-rendered HTML, independent of hover/JS state, so
 *   an LLM or crawler reading the page gets full granularity even though a
 *   human sees only the compact glance.
 */
export function FactValue({ fact }: FactValueProps) {
  const { status, text } = parseFactValue(fact.value)
  const isBoolean = status === 'yes' || status === 'no'
  const primarySource = fact.sources[0]

  const fullText = [fact.value, fact.detail].filter(Boolean).join('. ')

  const glance = isBoolean ? (
    status === 'yes' ? (
      <Check className='size-[14px] shrink-0 text-[var(--text-primary)]' aria-hidden='true' />
    ) : (
      <X className='size-[14px] shrink-0 text-[var(--text-muted)]' aria-hidden='true' />
    )
  ) : null

  // A pure yes/no fact renders as an icon only. The "why" lives in the
  // source link and the sr-only text, not cluttering the glance view.
  const shortText = isBoolean ? null : (fact.shortValue ?? text)

  const valueNode = glance ?? (
    <span className='truncate text-[var(--text-body)] text-small'>{shortText}</span>
  )

  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      {primarySource ? (
        <SourceLink source={primarySource} className={glance ? 'shrink-0' : 'min-w-0 truncate'}>
          {valueNode}
        </SourceLink>
      ) : (
        valueNode
      )}
      <span className='sr-only'>{fullText}</span>
    </div>
  )
}
