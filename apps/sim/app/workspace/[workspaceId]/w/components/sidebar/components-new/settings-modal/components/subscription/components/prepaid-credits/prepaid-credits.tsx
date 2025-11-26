'use client'

import { useState } from 'react'
import { Badge, Button } from '@/components/emcn'
import { PurchaseModal } from './purchase-modal'

interface PrepaidCreditsProps {
  balance: number
  totalPurchased: number
  totalUsed: number
  lastPurchaseAt: Date | string | null
  context: 'user' | 'organization'
  referenceId: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

export function PrepaidCredits({
  balance,
  totalPurchased,
  totalUsed,
  lastPurchaseAt,
  context,
  referenceId,
}: PrepaidCreditsProps) {
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)

  return (
    <>
      <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
        <div className='mb-2 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-sm'>Prepaid Credits</span>
            <Badge variant='outline' className='text-xs'>
              {formatCurrency(balance)} available
            </Badge>
          </div>
          <Button variant='outline' onClick={() => setShowPurchaseModal(true)}>
            Purchase Credits
          </Button>
        </div>

        <div className='grid grid-cols-3 gap-4 text-muted-foreground text-xs'>
          <div>
            <div className='font-medium text-foreground tabular-nums'>
              {formatCurrency(totalPurchased)}
            </div>
            <div>Total Purchased</div>
          </div>
          <div>
            <div className='font-medium text-foreground tabular-nums'>
              {formatCurrency(totalUsed)}
            </div>
            <div>Total Used</div>
          </div>
          <div>
            <div className='font-medium text-foreground'>
              {lastPurchaseAt ? formatDate(lastPurchaseAt) : 'Never'}
            </div>
            <div>Last Purchase</div>
          </div>
        </div>

        <div className='mt-2 text-muted-foreground text-xs'>
          Credits are used automatically before subscription charges
        </div>
      </div>

      <PurchaseModal
        open={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        referenceId={referenceId}
        referenceType={context}
      />
    </>
  )
}
