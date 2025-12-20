'use client'

import { useState } from 'react'
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
        <Label>Credit Balance</Label>
        <span className='text-[13px] text-[var(--text-secondary)]'>
          {isLoading ? '...' : `$${balance.toFixed(2)}`}
        </span>
      </div>

      {canPurchase && (
        <Modal open={isOpen} onOpenChange={handleOpenChange}>
          <ModalTrigger asChild>
            <Button variant='outline' className='h-8 rounded-[8px] text-[13px]'>
              Add Credits
            </Button>
          </ModalTrigger>
          <ModalContent size='sm'>
            <ModalHeader>Add Credits</ModalHeader>
            <ModalBody>
              {success ? (
                <p className='text-center text-[13px] text-[var(--text-primary)]'>
                  Credits added successfully!
                </p>
              ) : (
                <>
                  <p className='text-[12px] text-[var(--text-muted)]'>
                    Credits are used before overage charges. Min $10, max $1,000.
                  </p>

                  <div className='mt-4 flex flex-col gap-[4px]'>
                    <Label htmlFor='credit-amount'>Amount (USD)</Label>
                    <div className='relative'>
                      <span className='-translate-y-1/2 absolute top-1/2 left-3 text-[13px] text-[var(--text-secondary)]'>
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
                    {error && <span className='text-[12px] text-[var(--text-error)]'>{error}</span>}
                  </div>

                  <div className='mt-4 rounded-[6px] bg-[var(--surface-5)] p-3'>
                    <p className='text-[12px] text-[var(--text-muted)]'>
                      Credits are non-refundable and don't expire. They'll be applied automatically
                      to your {entityType === 'organization' ? 'team' : ''} usage.
                    </p>
                  </div>
                </>
              )}
            </ModalBody>
            {!success && (
              <ModalFooter>
                <ModalClose asChild>
                  <Button disabled={isPurchasing}>Cancel</Button>
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
