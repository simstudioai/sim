'use client'

import { useEffect, useRef, useState } from 'react'
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
import { dollarsToCredits, formatCredits } from '@/lib/billing/credits/conversion'
import { usePurchaseCredits } from '@/hooks/queries/subscription'

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
  const [validationError, setValidationError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const purchaseCredits = usePurchaseCredits()
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dollarAmount = Number.parseInt(amount, 10) || 0
  const creditPreview = dollarsToCredits(dollarAmount)

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  const resetModalState = () => {
    setAmount('')
    setValidationError(null)
    purchaseCredits.reset()
  }

  const openModal = () => {
    clearCloseTimeout()
    resetModalState()
    setRequestId(crypto.randomUUID())
    setIsOpen(true)
  }

  const closeModal = () => {
    clearCloseTimeout()
    setIsOpen(false)
    setRequestId(null)
    resetModalState()
  }

  useEffect(() => {
    return () => {
      clearCloseTimeout()
    }
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (open) {
      openModal()
      return
    }

    if (!purchaseCredits.isPending) {
      closeModal()
    }
  }

  const handleAmountChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '')
    setAmount(numericValue)
    setValidationError(null)
  }

  const handlePurchase = () => {
    if (!requestId || purchaseCredits.isPending) return

    const numAmount = Number.parseInt(amount, 10)

    if (Number.isNaN(numAmount) || numAmount < 10) {
      setValidationError('Minimum purchase is $10')
      return
    }

    if (numAmount > 1000) {
      setValidationError('Maximum purchase is $1,000')
      return
    }

    purchaseCredits.mutate(
      { amount: numAmount, requestId },
      {
        onSuccess: () => {
          onPurchaseComplete?.()
          clearCloseTimeout()
          closeTimeoutRef.current = setTimeout(() => {
            closeModal()
          }, 1500)
        },
      }
    )
  }

  const displayError = validationError || purchaseCredits.error?.message

  return (
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-2'>
        <Label>Additional Credits Balance:</Label>
        <span className='text-[var(--text-secondary)] text-small tabular-nums'>
          {isLoading ? '...' : `${formatCredits(balance)} credits`}
        </span>
      </div>

      {canPurchase && (
        <Modal open={isOpen} onOpenChange={handleOpenChange}>
          <ModalTrigger asChild>
            <Button variant='active'>Add Credits</Button>
          </ModalTrigger>
          <ModalContent size='sm'>
            <ModalHeader>Add Credits</ModalHeader>
            <ModalBody>
              {purchaseCredits.isSuccess ? (
                <p className='text-center text-[var(--text-primary)] text-small'>
                  Credits added successfully!
                </p>
              ) : (
                <div className='space-y-3'>
                  <div className='flex flex-col gap-2'>
                    <Label htmlFor='credit-amount'>Amount (USD)</Label>
                    <div className='relative'>
                      <span className='-translate-y-1/2 absolute top-1/2 left-[12px] text-[var(--text-muted)] text-small'>
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
                        disabled={purchaseCredits.isPending}
                      />
                    </div>
                    {dollarAmount > 0 && !displayError && (
                      <span className='text-[var(--text-secondary)] text-caption tabular-nums'>
                        You'll receive {creditPreview.toLocaleString()} credits
                      </span>
                    )}
                    {displayError && (
                      <span className='text-[var(--text-error)] text-small'>{displayError}</span>
                    )}
                  </div>

                  <div className='rounded-md bg-[var(--surface-4)] p-3'>
                    <p className='text-[var(--text-secondary)]'>
                      Credits are non-refundable and don't expire. They'll be applied automatically
                      to your {entityType === 'organization' ? 'team' : ''} usage.
                    </p>
                  </div>
                </div>
              )}
            </ModalBody>
            {!purchaseCredits.isSuccess && (
              <ModalFooter>
                <ModalClose asChild>
                  <Button variant='default' disabled={purchaseCredits.isPending}>
                    Cancel
                  </Button>
                </ModalClose>
                <Button
                  variant='primary'
                  onClick={handlePurchase}
                  disabled={purchaseCredits.isPending || !amount}
                >
                  {purchaseCredits.isPending ? 'Processing...' : 'Purchase'}
                </Button>
              </ModalFooter>
            )}
          </ModalContent>
        </Modal>
      )}
    </div>
  )
}
