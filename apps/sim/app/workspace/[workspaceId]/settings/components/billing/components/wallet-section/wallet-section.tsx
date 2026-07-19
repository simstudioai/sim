'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useTranslations } from 'next-intl'
import { Chip, ChipInput, toast } from '@/components/emcn'
import { creditsToDollars, dollarsToCredits, formatCredits } from '@/lib/billing/credits/conversion'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { usePurchaseCredits } from '@/hooks/queries/subscription'

/** Purchase bounds from `purchaseCreditsBodySchema` (dollars). */
const MIN_PURCHASE_DOLLARS = 10
const MAX_PURCHASE_DOLLARS = 1000

interface WalletSectionProps {
  /** Prepaid wallet balance, in dollars (Lago wallet credits when on Lago). */
  creditBalance: number
  /** Whether the viewer may add credits (org admins / solo paid users). */
  canManage: boolean
  /** Org id when the subscription is org-scoped — targets the org wallet. */
  organizationId?: string
}

/**
 * Displays the prepaid wallet balance and, for managers, a credits top-up
 * control. Unlike the home credits chip (hidden on enterprise), the balance is
 * shown for every plan so enterprise admins can still see their funded credits.
 * The input is in credits — Sim's display unit — and converts to dollars at the
 * purchase boundary, matching {@link UsageLimitField}.
 */
export function WalletSection({ creditBalance, canManage, organizationId }: WalletSectionProps) {
  const t = useTranslations('auto')
  const purchaseCredits = usePurchaseCredits()
  const [draft, setDraft] = useState('')

  const minCredits = dollarsToCredits(MIN_PURCHASE_DOLLARS)
  const maxCredits = dollarsToCredits(MAX_PURCHASE_DOLLARS)

  const handleAdd = () => {
    const credits = Number.parseFloat(draft)
    if (Number.isNaN(credits)) {
      toast.error('Amount must be a number')
      return
    }
    if (credits < minCredits || credits > maxCredits) {
      toast.error(
        `Amount must be between ${minCredits.toLocaleString()} and ${maxCredits.toLocaleString()} credits`
      )
      return
    }

    purchaseCredits.mutate(
      { amount: creditsToDollars(credits), requestId: generateId(), orgId: organizationId },
      {
        onSuccess: () => {
          setDraft('')
          toast.success('Credits added')
        },
        onError: (error) => {
          toast.error("Couldn't add credits", {
            description: getErrorMessage(error, 'Please try again in a moment.'),
          })
        },
      }
    )
  }

  return (
    <SettingsSection label={t('wallet')}>
      <div className='flex flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <span className='text-[var(--text-body)] text-small'>{t('credit_balance')}</span>
          <span className='text-[var(--text-muted)] text-small'>
            {formatCredits(creditBalance)}
          </span>
        </div>
        {canManage && (
          <div className='flex items-center gap-2'>
            <ChipInput
              type='number'
              inputMode='numeric'
              min={minCredits}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`${minCredits.toLocaleString()}–${maxCredits.toLocaleString()} credits`}
              disabled={purchaseCredits.isPending}
              className='min-w-0 flex-1'
              inputClassName='[&::-webkit-inner-spin-button]:appearance-none'
            />
            <Chip
              variant='primary'
              flush
              disabled={purchaseCredits.isPending || draft.trim() === ''}
              onClick={handleAdd}
            >
              {t('add_credits')}
            </Chip>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
