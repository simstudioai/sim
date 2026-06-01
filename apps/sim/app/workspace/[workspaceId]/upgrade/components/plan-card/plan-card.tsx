'use client'

import { ChipTag, chipVariants } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

/**
 * Props for {@link UpgradePlanCard}.
 */
export interface UpgradePlanCardProps {
  /** Plan name, e.g. `"Pro"`. */
  name: string
  /** Headline price, e.g. `"$29"` or `"Custom"`. */
  price: string
  /** Small line under the price, e.g. `"per user/month, billed annually"`. */
  priceSubtext?: string
  /** Optional discount pill rendered next to the price, e.g. `"20% off"`. */
  discountLabel?: string
  /** Optional struck-through original price, e.g. `"$34"`. */
  strikethroughPrice?: string
  /** Short description below the plan name, e.g. `"For growing teams"`. */
  segmentLabel: string
  /** Feature list — each row renders with a check icon. */
  features: string[]
  /** CTA label. */
  buttonText: string
  /** CTA click handler. */
  onButtonClick: () => void
  /** Whether the CTA is disabled. */
  buttonDisabled?: boolean
  /** When set, the CTA renders with the primary chip variant. */
  highlighted?: boolean
  /** Optional pill rendered in the top-right corner, e.g. `"Your plan"`. */
  bannerText?: string
  /** Extra outer classes. */
  className?: string
}

/**
 * Inline check icon — inherits color via `currentColor` from its `<li>` parent.
 */
function CheckIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none' aria-hidden='true'>
      <path
        d='M2.5 7L5.5 10L11.5 4'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

/**
 * Vertical pricing card styled with workspace surface, border, and text tokens.
 * CTA reuses {@link chipVariants} so it picks up the platform's standard 30px
 * pill chrome (primary filled when highlighted, neutral filled otherwise).
 */
export function UpgradePlanCard({
  name,
  price,
  priceSubtext,
  discountLabel,
  strikethroughPrice,
  segmentLabel,
  features,
  buttonText,
  onButtonClick,
  buttonDisabled,
  highlighted,
  bannerText,
  className,
}: UpgradePlanCardProps) {
  const showPill = Boolean(bannerText)

  return (
    <article
      className={cn(
        'flex h-full flex-col gap-4 rounded-xl border border-[var(--border-1)] bg-[var(--surface-2)] p-5',
        className
      )}
    >
      <div className='flex flex-col gap-4'>
        <div className='flex items-start justify-between gap-2'>
          <h3 className='font-medium text-[24px] text-[var(--text-primary)]'>{name}</h3>
          {showPill && <ChipTag variant='gray'>{bannerText}</ChipTag>}
        </div>

        <div className='flex flex-col'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-[20px] text-[var(--text-primary)] tabular-nums'>
              {price}
            </span>
            {discountLabel && <ChipTag variant='blue'>{discountLabel}</ChipTag>}
            {strikethroughPrice && (
              <span className='text-[var(--text-muted)] text-small line-through'>
                {strikethroughPrice}
              </span>
            )}
          </div>
          <p className='text-[var(--text-muted)] text-base'>{priceSubtext ?? '\u00A0'}</p>
        </div>

        <button
          type='button'
          onClick={onButtonClick}
          disabled={buttonDisabled}
          className={cn(
            chipVariants({
              variant: highlighted ? 'primary' : 'border-shadow',
              fullWidth: true,
              flush: true,
            }),
            'w-full justify-center text-center'
          )}
        >
          {buttonText}
        </button>
      </div>

      <div className='flex flex-col gap-2'>
        <p className='text-[var(--text-muted)] text-base'>{segmentLabel}</p>
        <ul className='flex flex-col gap-2'>
          {features.map((feature) => (
            <li key={feature} className='flex items-center gap-2 text-[var(--text-primary)]'>
              <CheckIcon />
              <span className='text-[var(--text-primary)] text-small'>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}
