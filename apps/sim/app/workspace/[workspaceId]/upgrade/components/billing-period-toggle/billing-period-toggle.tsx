'use client'

import { useTranslations } from 'next-intl'
import { ChipSwitch, ChipTag } from '@/components/emcn'
import { ANNUAL_DISCOUNT_RATE } from '@/lib/billing/constants'

/**
 * Props for {@link BillingPeriodToggle}.
 */
export interface BillingPeriodToggleProps {
  /** Whether the annual billing period is currently selected. */
  isAnnual: boolean
  /** Invoked with the next selection when a segment is clicked. */
  onChange: (isAnnual: boolean) => void
  /** Optional additional classes merged onto the container. */
  className?: string
}

/**
 * Discount label derived from the real billing constant so it stays in sync if
 * the rate changes (e.g. `0.15` renders as `-15%`).
 */
const DISCOUNT_LABEL = `-${Math.round(ANNUAL_DISCOUNT_RATE * 100)}%`

type Period = 'annual' | 'monthly'

/**
 * Annual / monthly billing-period segmented switch. Built on {@link ChipSwitch}
 * with an inline brand-tinted discount badge on the annual segment.
 */
export function BillingPeriodToggle({ isAnnual, onChange, className }: BillingPeriodToggleProps) {
  const t = useTranslations('auto')
  return (
    <ChipSwitch<Period>
      aria-label={t('billing_period')}
      value={isAnnual ? 'annual' : 'monthly'}
      onChange={(next) => onChange(next === 'annual')}
      className={className}
      options={[
        {
          value: 'annual',
          label: (
            <>
              {t('annual')}
              <ChipTag variant='mono' className={isAnnual ? undefined : 'text-inherit'}>
                {DISCOUNT_LABEL}
              </ChipTag>
            </>
          ),
        },
        { value: 'monthly', label: 'Monthly' },
      ]}
    />
  )
}
