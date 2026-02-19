'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
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
        setError(data.error || 'Code could not be redeemed')
      }
    } catch (err) {
      logger.error('Referral code redemption failed', { error: err })
      setError(err instanceof Error ? err.message : 'Failed to redeem code')
    } finally {
      setIsRedeeming(false)
    }
  }

  if (success) {
    return (
      <div className='flex items-center justify-between'>
        <Label>Referral Code</Label>
        <span className='text-[12px] text-[var(--text-secondary)]'>
          +${success.bonusAmount} credits applied
        </span>
      </div>
    )
  }

  return (
    <div className='flex flex-col'>
      <div className='flex items-center justify-between gap-[12px]'>
        <Label className='shrink-0'>Referral Code</Label>
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
            placeholder='Enter code'
            className='h-[32px] w-[140px] text-[12px]'
            disabled={isRedeeming}
          />
          <Button
            variant='active'
            className='h-[32px] shrink-0 rounded-[6px] text-[12px]'
            onClick={handleRedeem}
            disabled={isRedeeming || !code.trim()}
          >
            {isRedeeming ? 'Redeeming...' : 'Redeem'}
          </Button>
        </div>
      </div>
      <div className='mt-[4px] min-h-[18px] text-right'>
        {error && <span className='text-[11px] text-[var(--text-error)]'>{error}</span>}
      </div>
    </div>
  )
}
