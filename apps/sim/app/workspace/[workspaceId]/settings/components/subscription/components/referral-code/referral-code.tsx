'use client'

import { useState } from 'react'
import { Button, Input, Label } from '@/components/emcn'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { useRedeemReferralCode } from '@/hooks/queries/subscription'

interface ReferralCodeProps {
  onRedeemComplete?: () => void
}

/**
 * Inline referral/promo code entry field with redeem button.
 * One-time use per account — shows success or "already redeemed" state.
 */
export function ReferralCode({ onRedeemComplete }: ReferralCodeProps) {
  const [code, setCode] = useState('')
  const redeemCode = useRedeemReferralCode()

  const handleRedeem = () => {
    const trimmed = code.trim()
    if (!trimmed || redeemCode.isPending) return

    redeemCode.mutate(
      { code: trimmed },
      {
        onSuccess: () => {
          setCode('')
          onRedeemComplete?.()
        },
      }
    )
  }

  if (redeemCode.isSuccess) {
    return (
      <div className='flex items-center justify-between'>
        <Label>Referral Code</Label>
        <span className='text-[13px] text-[var(--text-secondary)]'>
          +{dollarsToCredits(redeemCode.data.bonusAmount ?? 0).toLocaleString()} credits applied
        </span>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-[4px]'>
      <div className='flex items-center justify-between gap-[12px]'>
        <Label className='shrink-0'>Referral Code</Label>
        <div className='flex items-center gap-[8px]'>
          <Input
            type='text'
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              redeemCode.reset()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRedeem()
            }}
            placeholder='Enter code'
            className='h-[32px] w-[140px] bg-[var(--surface-4)] text-[13px]'
            disabled={redeemCode.isPending}
          />
          <Button
            variant='default'
            className='h-[32px] shrink-0 text-[13px]'
            onClick={handleRedeem}
            disabled={redeemCode.isPending || !code.trim()}
          >
            {redeemCode.isPending ? 'Redeeming...' : 'Redeem'}
          </Button>
        </div>
      </div>
      {redeemCode.error && (
        <span className='text-right text-[11px] text-[var(--text-error)]'>
          {redeemCode.error.message}
        </span>
      )}
    </div>
  )
}
