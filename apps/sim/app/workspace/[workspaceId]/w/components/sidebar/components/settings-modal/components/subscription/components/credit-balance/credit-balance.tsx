'use client'

import { useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTrigger,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CreditBalance')

interface CreditBalanceProps {
  balance: number
  canPurchase: boolean
  entityType: 'user' | 'organization'
  isLoading?: boolean
  onPurchaseComplete?: () => void
}

export function CreditBalance({
  balance,
  canPurchase,
  entityType,
  isLoading,
  onPurchaseComplete,
}: CreditBalanceProps) {
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
      setError('Minimum purchase is $10')
      return
    }

    if (numAmount > 1000) {
      setError('Maximum purchase is $1,000')
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
      setError(err instanceof Error ? err.message : 'Failed to purchase credits')
    } finally {
      setIsPurchasing(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) {
      // Generate new requestId when modal opens - same ID used for entire session
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
      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground text-sm'>Credit Balance</span>
        <span className='font-medium text-sm'>{isLoading ? '...' : `$${balance.toFixed(2)}`}</span>
      </div>

      {canPurchase && (
        <Modal open={isOpen} onOpenChange={handleOpenChange}>
          <ModalTrigger asChild>
            <Button variant='outline'>Add Credits</Button>
          </ModalTrigger>
          <ModalContent>
            <ModalHeader>Add Credits</ModalHeader>
            <div className='px-4'>
              <p className='text-[13px] text-[var(--text-secondary)]'>
                Credits are used before overage charges. Min $10, max $1,000.
              </p>
            </div>

            {success ? (
              <div className='py-4 text-center'>
                <p className='text-[14px] text-[var(--text-primary)]'>
                  Credits added successfully!
                </p>
              </div>
            ) : (
              <div className='flex flex-col gap-3 py-2'>
                <div className='flex flex-col gap-1'>
                  <label
                    htmlFor='credit-amount'
                    className='text-[12px] text-[var(--text-secondary)]'
                  >
                    Amount (USD)
                  </label>
                  <div className='relative'>
                    <span className='-translate-y-1/2 absolute top-1/2 left-3 text-[var(--text-secondary)]'>
                      $
                    </span>
                    <Input
                      id='credit-amount'
                      type='text'
                      inputMode='numeric'
                      value={amount}
                      onChange={(e) => handleAmountChange(e.target.value)}
                      placeholder='50'
                      className='pl-7'
                      disabled={isPurchasing}
                    />
                  </div>
                  {error && <span className='text-[11px] text-red-500'>{error}</span>}
                </div>

                <div className='rounded-[4px] bg-[var(--surface-5)] p-2'>
                  <p className='text-[11px] text-[var(--text-tertiary)]'>
                    Credits are non-refundable and don't expire. They'll be applied automatically to
                    your {entityType === 'organization' ? 'team' : ''} usage.
                  </p>
                </div>
              </div>
            )}

            {!success && (
              <ModalFooter>
                <ModalClose asChild>
                  <Button variant='ghost' disabled={isPurchasing}>
                    Cancel
                  </Button>
                </ModalClose>
                <Button
                  variant='primary'
                  onClick={handlePurchase}
                  disabled={isPurchasing || !amount}
                >
                  {isPurchasing ? 'Processing...' : 'Purchase'}
                </Button>
              </ModalFooter>
            )}
          </ModalContent>
        </Modal>
      )}
    </div>
  )
}
