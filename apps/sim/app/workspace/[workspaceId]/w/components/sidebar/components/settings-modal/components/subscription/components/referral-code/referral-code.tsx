'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { useTranslations } from 'next-intl'
import { Button, Input, Label } from '@/components/emcn'

const logger = createLogger('ReferralCode')

interface ReferralCodeProps {
  onRedeemComplete?: () => void
}

/**
 * Inline referral/promo code entry field with redeem button.
 * One-time use per account — shows success or "already redeemed" state.
 */
export function ReferralCode({ onRedeemComplete }: ReferralCodeProps) {
  const t = useTranslations()
  const [code, setCode] = useState('')
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ bonusAmount: number } | null>(null)

  const handleRedeem = async () => {
    const trimmed = code.trim()
    if (!trimmed || isRedeeming) return

    setIsRedeeming(true)
    setError(null)

    try {
      const response = await fetch('/api/referral-code/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to redeem code')
      }

      if (data.redeemed) {
        setSuccess({ bonusAmount: data.bonusAmount })
        setCode('')
        onRedeemComplete?.()
      } else {
        setError(data.error || t('settings.referral_code.errors.could_not_redeem'))
      }
    } catch (err) {
      logger.error('Referral code redemption failed', { error: err })
      setError(
        err instanceof Error ? err.message : t('settings.referral_code.errors.failed_to_redeem')
      )
    } finally {
      setIsRedeeming(false)
    }
  }

  if (success) {
    return (
      <div className='flex items-center justify-between'>
        <Label>{t('settings.referral_code.labels.referral_code')}</Label>
        <span className='text-[12px] text-[var(--text-secondary)]'>
          {t('settings.referral_code.credits_applied', { amount: success.bonusAmount })}
        </span>
      </div>
    )
  }

  return (
    <div className='flex flex-col'>
      <div className='flex items-center justify-between gap-[12px]'>
        <Label className='shrink-0'>{t('settings.referral_code.labels.referral_code')}</Label>
        <div className='flex items-center gap-[8px]'>
          <Input
            type='text'
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRedeem()
            }}
            placeholder={t('settings.referral_code.placeholders.enter_code')}
            className='h-[32px] w-[140px] text-[12px]'
            disabled={isRedeeming}
          />
          <Button
            variant='active'
            className='h-[32px] shrink-0 rounded-[6px] text-[12px]'
            onClick={handleRedeem}
            disabled={isRedeeming || !code.trim()}
          >
            {isRedeeming
              ? t('settings.referral_code.buttons.redeeming')
              : t('settings.referral_code.buttons.redeem')}
          </Button>
        </div>
      </div>
      <div className='mt-[4px] min-h-[18px] text-right'>
        {error && <span className='text-[11px] text-[var(--text-error)]'>{error}</span>}
      </div>
    </div>
  )
}
