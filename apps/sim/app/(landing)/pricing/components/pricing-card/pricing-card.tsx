import { Check, ChipLink, ChipTag } from '@/components/emcn'
import { SlackIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import type { CellValue } from '@/app/workspace/[workspaceId]/upgrade/components/comparison-table/comparison-data'

/** Maps a cell-icon identifier to its brand icon component. */
const CELL_ICONS = { slack: SlackIcon } as const

/** Resolved CTA for a pricing card - label, chip variant, and destination href. */
export interface PricingCardCta {
  label: string
  variant: 'primary' | 'border-shadow'
  href: string
}

/** A labelled group of feature rows for one plan, transposed from the comparison data. */
export interface PricingCardSection {
  /** Stable key for the section, used for React reconciliation. */
  key: string
  /** Section header, e.g. `"Rate limits (runs/min)"`. Omit to render the rows without a header. */
  title?: string
  /** Feature rows - this plan's value for each comparison row in the section. */
  rows: { label: string; value: CellValue }[]
}

/**
 * Props for {@link PricingCard}.
 */
export interface PricingCardProps {
  /** Plan name, e.g. `"Pro"`. */
  name: string
  /** Headline price, e.g. `"$25"`, `"$0"`, or `"Custom"`. */
  price: string
  /** Small line under the price, e.g. `"per user/month, billed monthly"`. */
  priceSubtext?: string
  /** Optional discount pill next to the price, e.g. `"15% off"`. */
  discountLabel?: string
  /** Resolved CTA - label, variant, and destination href. */
  cta: PricingCardCta
  /** Full feature breakdown for this plan, grouped by section. */
  sections: PricingCardSection[]
  /** Extra outer classes. */
  className?: string
}

/**
 * Renders one plan's value for a feature row: `true` → check, `false` → em-dash,
 * an icon reference → its brand icon, a string → right-aligned text.
 */
function FeatureValue({ value }: { value: CellValue }) {
  if (value === true) {
    return <Check className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
  }
  if (value === false) {
    return <span className='select-none text-[var(--text-muted)]'>–</span>
  }
  if (typeof value === 'object') {
    const Icon = CELL_ICONS[value.icon]
    return <Icon className='size-[14px] flex-shrink-0' />
  }
  return (
    <span className='whitespace-nowrap text-right text-[var(--text-primary)] text-sm tabular-nums'>
      {value}
    </span>
  )
}

/**
 * Public pricing card - one plan rendered as a self-contained spec sheet: the
 * header (name, price, CTA, segment) above the full comparison breakdown, grouped
 * by section with a hairline rule under each section header.
 *
 * The radius (`rounded-lg`) matches the landing hero's visual panel so the cards
 * line up with the rest of the landing chrome. Every card carries the identical
 * row structure (only values differ) so a grid of them renders at exactly the
 * same height. Feature rows are transposed from the shared comparison data, so
 * the card can never drift from the platform.
 */
export function PricingCard({
  name,
  price,
  priceSubtext,
  discountLabel,
  cta,
  sections,
  className,
}: PricingCardProps) {
  return (
    <article
      className={cn(
        'flex h-full flex-col gap-[22px] rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)] p-5',
        className
      )}
    >
      <div className='flex flex-col gap-[22px]'>
        <h2 className='text-[24px] text-[var(--text-primary)]'>{name}</h2>

        <div className='flex flex-col'>
          <div className='flex items-center gap-2'>
            <span className='text-[20px] text-[var(--text-primary)] tabular-nums'>{price}</span>
            {discountLabel && <ChipTag variant='mono'>{discountLabel}</ChipTag>}
          </div>
          <p className='text-[var(--text-muted)] text-base'>{priceSubtext ?? ' '}</p>
        </div>

        <ChipLink
          href={cta.href}
          variant={cta.variant}
          fullWidth
          flush
          className='w-full justify-center'
        >
          {cta.label}
        </ChipLink>
      </div>

      <div className='flex flex-col gap-5'>
        {sections.map((section) => (
          <div key={section.key} className='flex flex-col'>
            {section.title && (
              <>
                <span className='text-[var(--text-primary)] text-small'>{section.title}</span>
                <div className='mt-2 mb-2.5 h-px bg-[var(--border)]' />
              </>
            )}
            <div className='flex flex-col gap-2.5'>
              {section.rows.map((row) => (
                <div key={row.label} className='flex items-center justify-between gap-3'>
                  <span className='text-[var(--text-body)] text-sm'>{row.label}</span>
                  <FeatureValue value={row.value} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}
