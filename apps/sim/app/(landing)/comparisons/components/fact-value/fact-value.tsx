import { Check, X } from '@sim/emcn/icons'
import type { Fact } from '@/lib/compare/data'
import { SourceLink } from '@/app/(landing)/comparisons/components/source-info'
import { parseFactValue } from '@/app/(landing)/comparisons/fact-status'

export interface FactValueProps {
  fact: Fact
}

const TERMINAL_PUNCTUATION = /[.!?][\])}'"’”]*$/

/**
 * Keeps the full value and detail in server-rendered text while displaying
 * a compact value. Only verified boolean claims use icons; other claims keep
 * their confidence labels and fall back to the original value when needed.
 * Source tooltips stay brief so qualifications remain available without hover.
 */
export function FactValue({ fact }: FactValueProps) {
  const { status } = parseFactValue(fact.value)
  const isBoolean = fact.confidence === 'verified' && (status === 'yes' || status === 'no')
  const primarySource = fact.sources[0]

  const detailSeparator = TERMINAL_PUNCTUATION.test(fact.value.trimEnd()) ? ' ' : '. '
  const fullText = fact.detail ? `${fact.value}${detailSeparator}${fact.detail}` : fact.value

  const glance = isBoolean ? (
    status === 'yes' ? (
      <Check className='size-[14px] shrink-0 text-[var(--text-primary)]' aria-hidden='true' />
    ) : (
      <X className='size-[14px] shrink-0 text-[var(--text-muted)]' aria-hidden='true' />
    )
  ) : null

  const shortText = isBoolean ? null : (fact.shortValue ?? fact.value)

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
      {fact.confidence !== 'verified' ? (
        <span className='shrink-0 text-[var(--text-muted)] text-caption'>
          {fact.confidence === 'estimated' ? '(estimate)' : '(unverified)'}
        </span>
      ) : null}
      <span className='sr-only'>{fullText}</span>
    </div>
  )
}
