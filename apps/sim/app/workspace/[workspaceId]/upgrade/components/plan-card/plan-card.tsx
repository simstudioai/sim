'use client'
import { Check, ChipTag, Credit, chipVariants, cn, Info, RefreshCw } from '@sim/emcn'

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
  /** Short description below the plan name, e.g. `"For growing teams"`. */
  segmentLabel: string
  /**
   * Monthly credit allocation shown prominently under the CTA, e.g. `"6,000 credits/mo"` or `"Custom"`.
   * When omitted the credits/refresh block is not rendered.
   */
  credits?: string
  /**
   * Daily refresh allocation shown below the credit amount, e.g. `"+50/day refresh"`.
   * Only rendered when {@link UpgradePlanCardProps.credits} is also set.
   */
  refresh?: string
  /** Feature bullet list — each row renders with a check icon. */
  features: readonly string[]
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
 * Vertical pricing card styled with workspace surface, border, and text tokens.
 * CTA reuses {@link chipVariants} so it picks up the platform's standard 30px
 * pill chrome (primary filled when highlighted, neutral filled otherwise).
 *
 * When `credits` is supplied, a prominent stats block using the same `Credit`
 * icon as the home-page chip is rendered directly below the CTA, followed by a
 * solid `1px` divider (matching the integrations/skills section separator) before
 * the bullet feature list. Pass `credits` on every card tier, including Enterprise
 * (which uses `"Custom"` for both `credits` and `refresh`).
 */
export function UpgradePlanCard({
  name,
  price,
  priceSubtext,
  discountLabel,
  segmentLabel,
  credits,
  refresh,
  features,
  buttonText,
  onButtonClick,
  buttonDisabled,
  highlighted,
  bannerText,
  className,
}: UpgradePlanCardProps) {
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
          {bannerText && <ChipTag variant='gray'>{bannerText}</ChipTag>}
        </div>

        <div className='flex flex-col'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-[20px] text-[var(--text-primary)] tabular-nums'>
              {price}
            </span>
            {discountLabel && <ChipTag variant='mono'>{discountLabel}</ChipTag>}
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
            'w-full justify-center'
          )}
        >
          {buttonText}
        </button>

        {/* Credits + refresh stats block — omitted on plans without a fixed credit amount */}
        {credits && (
          <div className='flex flex-col gap-1.5'>
            <div className='flex items-center gap-1.5'>
              <Credit className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              <span className='text-[var(--text-body)] text-sm'>{credits}</span>
              <Info>1 workflow run = 1 credit. Inference usage consumes credits separately.</Info>
            </div>
            {refresh && (
              <div className='flex items-center gap-1.5'>
                <RefreshCw className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                <span className='text-[var(--text-body)] text-sm'>{refresh}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section header + divider matching integrations/skills separator language */}
      <div className='flex flex-col'>
        <span className='pl-0.5 text-[var(--text-muted)] text-small'>{segmentLabel}</span>
        <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
        <ul className='flex flex-col gap-2'>
          {features.map((feature) => (
            <li key={feature} className='flex items-center gap-2'>
              <Check className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
              <span className='text-[var(--text-body)] text-sm'>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}
