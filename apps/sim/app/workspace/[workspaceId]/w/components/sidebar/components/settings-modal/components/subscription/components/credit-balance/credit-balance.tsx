'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { useTranslations } from 'next-intl'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTrigger,
} from '@/components/emcn'

const logger = createLogger('CreditBalance')

interface CreditBalanceProps {
  balance: number
  canPurchase: boolean
  entityType: 'user' | 'organization'
  isLoading?: boolean
  onPurchaseComplete?: () => void
}

/**
 * Displays credit balance with optional purchase modal.
 */
export function CreditBalance({
  balance,
  canPurchase,
  entityType,
  isLoading,
  onPurchaseComplete,
}: CreditBalanceProps) {
  const t = useTranslations()
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [isPurchasing, setIsPurchasing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)

  const handleAmountChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '')
    setAmount(numericValue)
    setError(null)
  }

  const handlePurchase = async () => {
    if (!requestId || isPurchasing) return

    const numAmount = Number.parseInt(amount, 10)

    if (Number.isNaN(numAmount) || numAmount < 10) {
      setError(t('settings.credit_balance.errors.minimum_purchase'))
      return
    }

    if (numAmount > 1000) {
      setError(t('settings.credit_balance.errors.maximum_purchase'))
      return
    }

    setIsPurchasing(true)
    setError(null)

    try {
      const response = await fetch('/api/billing/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: numAmount, requestId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to purchase credits')
      }

      setSuccess(true)
      setTimeout(() => {
        setIsOpen(false)
        onPurchaseComplete?.()
      }, 1500)
    } catch (err) {
      logger.error('Credit purchase failed', { error: err })
      setError(
        err instanceof Error ? err.message : t('settings.credit_balance.errors.failed_to_purchase')
      )
    } finally {
      setIsPurchasing(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) {
      setRequestId(crypto.randomUUID())
    } else {
      setAmount('')
      setError(null)
      setSuccess(false)
      setRequestId(null)
    }
  }

  return (
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-[8px]'>
        <Label>{t('settings.credit_balance.labels.credit_balance')}</Label>
        <span className='text-[12px] text-[var(--text-secondary)]'>
          {isLoading ? '...' : `$${balance.toFixed(2)}`}
        </span>
      </div>

      {canPurchase && (
        <Modal open={isOpen} onOpenChange={handleOpenChange}>
          <ModalTrigger asChild>
            <Button variant='active' className='h-[32px] rounded-[6px] text-[12px]'>
              {t('settings.credit_balance.buttons.add_credits')}
            </Button>
          </ModalTrigger>
          <ModalContent size='sm'>
            <ModalHeader>{t('settings.credit_balance.buttons.add_credits')}</ModalHeader>
            <ModalBody>
              {success ? (
                <p className='text-center text-[12px] text-[var(--text-primary)]'>
                  {t('settings.credit_balance.success_message')}
                </p>
              ) : (
                <div className='space-y-[12px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='credit-amount'>
                      {t('settings.credit_balance.labels.amount_usd')}
                    </Label>
                    <div className='relative'>
                      <span className='-translate-y-1/2 absolute top-1/2 left-[12px] text-[12px] text-[var(--text-muted)]'>
                        $
                      </span>
                      <Input
                        id='credit-amount'
                        type='text'
                        inputMode='numeric'
                        value={amount}
                        onChange={(e) => handleAmountChange(e.target.value)}
                        placeholder='50'
                        className='pl-[28px]'
                        disabled={isPurchasing}
                      />
                    </div>
                    {error && <span className='text-[12px] text-[var(--text-error)]'>{error}</span>}
                  </div>

                  <div className='rounded-[6px] bg-[var(--surface-4)] p-[12px]'>
                    <p className='text-[12px] text-[var(--text-secondary)]'>
                      {t('settings.credit_balance.credits_info')}
                    </p>
                  </div>
                  <div className='rounded-[6px] bg-[var(--surface-4)] p-[12px]'>
                    <p className='text-[12px] text-[var(--text-secondary)]'>
                      {entityType === 'organization'
                        ? t('settings.credit_balance.credits_info_team')
                        : t('settings.credit_balance.credits_info_personal')}
                    </p>
                  </div>
                </div>
              )}
            </ModalBody>
            {!success && (
              <ModalFooter>
                <ModalClose asChild>
                  <Button variant='default' disabled={isPurchasing}>
                    {t('settings.credit_balance.buttons.cancel')}
                  </Button>
                </ModalClose>
                <Button
                  variant='tertiary'
                  onClick={handlePurchase}
                  disabled={isPurchasing || !amount}
                >
                  {isPurchasing
                    ? t('settings.credit_balance.buttons.processing')
                    : t('settings.credit_balance.buttons.purchase')}
                </Button>
              </ModalFooter>
            )}
          </ModalContent>
        </Modal>
      )}
    </div>
  )
}
