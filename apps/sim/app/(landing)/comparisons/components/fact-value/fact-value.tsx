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

/**
 * Renders a compact fact with access to every citation. Full fact text and
 * source metadata remain in the server-rendered HTML for assistive technology
 * and crawlers, while the popover provides individually clickable sources.
 */
export function FactValue({ fact, label, tone = 'default', wrap = false }: FactValueProps) {
  const { status, text } = parseFactValue(fact.value)
  const isBoolean = status === 'yes' || status === 'no'

  const detailSeparator = /[.!?]$/.test(fact.value.trimEnd()) ? ' ' : '. '
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

  const shortText = isBoolean ? null : (fact.shortValue ?? text)

  const valueNode = glance ?? (
    <span
      className={cn(
        'block min-w-0 text-[var(--text-body)] text-sm',
        wrap ? 'whitespace-normal break-words leading-relaxed' : 'truncate',
        tone === 'inverse-desktop' && 'lg:text-white'
      )}
    >
      {shortText}
    </span>
  )

  return (
    <div className='flex w-full min-w-0 items-center'>
      <SourcePopover sources={fact.sources} label={label} tone={tone}>
        {valueNode}
      </SourcePopover>
      <span className='sr-only'>
        {fullText}
        {fact.sources.map((source) => (
          <span key={source.url}>
            {' '}
            Source: {source.label}. {source.url}. Verified {source.asOf}.
          </span>
        ))}
      </span>
    </div>
  )
}
