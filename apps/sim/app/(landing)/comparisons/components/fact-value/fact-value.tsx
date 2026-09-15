import { cn } from '@sim/emcn'
import { Check, X } from '@sim/emcn/icons'
import type { Fact } from '@/lib/compare/data'
import { SourcePopover } from '@/app/(landing)/comparisons/components/source-info/source-popover'
import { parseFactValue } from '@/app/(landing)/comparisons/fact-status'

export interface FactValueProps {
  fact: Fact
  label: string
  tone?: 'default' | 'inverse-desktop'
  wrap?: boolean
}

const TERMINAL_PUNCTUATION = /[.!?][\])}'"’”]*$/

/**
 * Renders a compact fact with access to every citation. Full fact text and
 * source metadata remain in the server-rendered HTML for assistive technology
 * and crawlers, while the popover provides individually clickable sources.
 */
export function FactValue({ fact, label, tone = 'default', wrap = false }: FactValueProps) {
  const { status } = parseFactValue(fact.value)
  const isBoolean = fact.confidence === 'verified' && (status === 'yes' || status === 'no')

  const detailSeparator = TERMINAL_PUNCTUATION.test(fact.value.trimEnd()) ? ' ' : '. '
  const fullText = fact.detail ? `${fact.value}${detailSeparator}${fact.detail}` : fact.value

  const glance = isBoolean ? (
    status === 'yes' ? (
      <Check
        className={cn(
          'size-[14px] shrink-0 text-[var(--text-primary)]',
          tone === 'inverse-desktop' && 'lg:text-white'
        )}
        aria-hidden='true'
      />
    ) : (
      <X
        className={cn(
          'size-[14px] shrink-0 text-[var(--text-muted)]',
          tone === 'inverse-desktop' && 'lg:text-white/70'
        )}
        aria-hidden='true'
      />
    )
  ) : null

  const shortText = fact.sources.length === 0 ? fullText : (fact.shortValue ?? fact.value)

  const valueNode = (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[var(--text-body)] text-sm',
        wrap ? 'whitespace-normal break-words leading-relaxed' : 'truncate',
        tone === 'inverse-desktop' && 'lg:text-white'
      )}
    >
      {glance}
      <span className={cn('min-w-0', !wrap && 'truncate')}>{shortText}</span>
    </span>
  )

  return (
    <div className='flex w-full min-w-0 items-center'>
      <SourcePopover sources={fact.sources} label={label} tone={tone} description={fullText}>
        {valueNode}
      </SourcePopover>
      {fact.confidence !== 'verified' ? (
        <span className='ml-1.5 shrink-0 text-[var(--text-muted)] text-caption'>
          {fact.confidence === 'estimated' ? '(estimate)' : '(unverified)'}
        </span>
      ) : null}
      {fact.sources.length > 0 ? (
        <span className='sr-only'>
          {fullText}
          {fact.sources.map((source) => (
            <span key={source.url}>
              {' '}
              Source: {source.label}. {source.url}. Checked {source.asOf}.
            </span>
          ))}
        </span>
      ) : null}
    </div>
  )
}
