'use client'

import { useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PurchaseCreditsModal')

interface PurchaseModalProps {
  open: boolean
  onClose: () => void
  referenceId: string
  referenceType: 'user' | 'organization'
}

const PRESET_AMOUNTS = [100, 250, 500, 1000, 2500]

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function PurchaseModal({ open, onClose, referenceId, referenceType }: PurchaseModalProps) {
  const [amount, setAmount] = useState(100)
  const [isCustom, setIsCustom] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePurchase = async () => {
    // Prevent double-click/double-submit
    if (isLoading) return

    if (amount < 50 || amount > 10000) {
      setError('Amount must be between $50 and $10,000')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/billing/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          referenceId,
          referenceType,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      // Redirect to Stripe Checkout
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to purchase credits'
      logger.error('Credit purchase error', { error: err })
      setError(message)
      setIsLoading(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onClose}>
      <ModalContent className='max-w-md'>
        <ModalHeader>
          <ModalTitle>Purchase Prepaid Credits</ModalTitle>
          <ModalDescription>
            Credits are applied automatically before subscription charges and never expire
          </ModalDescription>
        </ModalHeader>

        <div className='space-y-4 px-6 py-4'>
          {/* Preset Amounts */}
          <div>
            <span className='mb-2 block font-medium text-sm'>Select Amount</span>
            <div className='grid grid-cols-3 gap-2'>
              {PRESET_AMOUNTS.map((preset) => (
                <Button
                  key={preset}
                  variant={amount === preset && !isCustom ? 'default' : 'outline'}
                  onClick={() => {
                    setAmount(preset)
                    setIsCustom(false)
                  }}
                  className='text-sm'
                >
                  {formatCurrency(preset)}
                </Button>
              ))}
              <Button
                variant={isCustom ? 'default' : 'outline'}
                onClick={() => setIsCustom(true)}
                className='text-sm'
              >
                Custom
              </Button>
            </div>
          </div>

          {/* Custom Amount Input */}
          {isCustom && (
            <div>
              <label htmlFor='custom-amount' className='mb-2 block font-medium text-sm'>
                Custom Amount (USD)
              </label>
              <Input
                id='custom-amount'
                type='number'
                min={50}
                max={10000}
                step={10}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder='Enter amount'
              />
              <p className='mt-1 text-muted-foreground text-xs'>Minimum: $50 · Maximum: $10,000</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className='rounded-md bg-red-50 p-3 text-red-800 text-sm dark:bg-red-950 dark:text-red-200'>
              {error}
            </div>
          )}
        </div>

        <ModalFooter>
          <Button variant='outline' onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handlePurchase} disabled={isLoading || amount < 50 || amount > 10000}>
            {isLoading ? 'Redirecting...' : `Purchase ${formatCurrency(amount)}`}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
