'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
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
        <Label>Credit Balance:</Label>
        <span className='text-[12px] text-[var(--text-secondary)]'>
          {isLoading ? '...' : `$${balance.toFixed(2)}`}
        </span>
      </div>

      {canPurchase && (
        <Modal open={isOpen} onOpenChange={handleOpenChange}>
          <ModalTrigger asChild>
            <Button variant='active' className='h-[32px] rounded-[6px] text-[12px]'>
              Add Credits
            </Button>
          </ModalTrigger>
          <ModalContent size='sm'>
            <ModalHeader>Add Credits</ModalHeader>
            <ModalBody>
              {success ? (
                <p className='text-center text-[12px] text-[var(--text-primary)]'>
                  Credits added successfully!
                </p>
              ) : (
                <div className='space-y-[12px]'>
                  <div className='flex flex-col gap-[8px]'>
                    <Label htmlFor='credit-amount'>Amount (USD)</Label>
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
                      Credits are used before overage charges. Min: $10, Max: $1,000.
                    </p>
                  </div>
                  <div className='rounded-[6px] bg-[var(--surface-4)] p-[12px]'>
                    <p className='text-[12px] text-[var(--text-secondary)]'>
                      Credits are non-refundable and don't expire. They'll be applied automatically
                      to your {entityType === 'organization' ? 'team' : ''} usage.
                    </p>
                  </div>
                </div>
              )}
            </ModalBody>
            {!success && (
              <ModalFooter>
                <ModalClose asChild>
                  <Button variant='default' disabled={isPurchasing}>
                    Cancel
                  </Button>
                </ModalClose>
                <Button
                  variant='tertiary'
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
