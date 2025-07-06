import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useActiveOrganization, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('BillingSummary')

interface BillingSummaryData {
  type: 'individual' | 'organization'
  plan: string
  currentUsage: number
  planMinimum: number
  projectedCharge: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  daysRemaining: number
  organizationData?: {
    seatCount: number
    averageUsagePerSeat: number
    totalMinimum: number
  }
}

interface BillingSummaryProps {
  showDetails?: boolean
  className?: string
  onDataLoaded?: (data: BillingSummaryData) => void
  onError?: (error: string) => void
}

export function BillingSummary({
  showDetails = true,
  className = '',
  onDataLoaded,
  onError,
}: BillingSummaryProps) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()

  const [billingSummary, setBillingSummary] = useState<BillingSummaryData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadBillingSummary() {
      if (!session?.user?.id) return

      try {
        setIsLoading(true)

        const url = new URL('/api/billing', window.location.origin)
        if (activeOrg?.id) {
          url.searchParams.set('context', 'organization')
          url.searchParams.set('id', activeOrg.id)
        } else {
          url.searchParams.set('context', 'user')
        }

        const response = await fetch(url.toString())
        if (!response.ok) {
          throw new Error(`Failed to fetch billing summary: ${response.statusText}`)
        }

        const result = await response.json()
        if (!result.success) {
          throw new Error(result.error || 'Failed to load billing data')
        }

        setBillingSummary(result.data)
        setError(null)
        onDataLoaded?.(result.data)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load billing data'
        setError(errorMessage)
        onError?.(errorMessage)
        logger.error('Failed to load billing summary', { error: err })
      } finally {
        setIsLoading(false)
      }
    }

    loadBillingSummary()
  }, [session?.user?.id, activeOrg?.id, onDataLoaded, onError])

  const getStatusBadge = () => {
    if (!billingSummary) return null

    if (billingSummary.isExceeded) {
      return (
        <Badge variant='destructive' className='gap-1'>
          <AlertCircle className='h-3 w-3' />
          Limit Exceeded
        </Badge>
      )
    }
    if (billingSummary.isWarning) {
      return (
        <Badge variant='outline' className='gap-1 border-yellow-500 text-yellow-700'>
          <AlertCircle className='h-3 w-3' />
          Approaching Limit
        </Badge>
      )
    }
    return null
  }

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`

  if (isLoading || error || !billingSummary) {
    return null
  }

  return (
    <div className={className}>
      {/* Status Badge */}
      {getStatusBadge()}

      {/* Billing Details */}
      {showDetails && (
        <div className='mt-3 space-y-1 text-muted-foreground text-xs'>
          <div className='flex justify-between'>
            <span>Plan minimum:</span>
            <span>{formatCurrency(billingSummary.planMinimum)}</span>
          </div>
          <div className='flex justify-between'>
            <span>Projected charge:</span>
            <span className='font-medium'>{formatCurrency(billingSummary.projectedCharge)}</span>
          </div>
          {billingSummary.organizationData && (
            <div className='flex justify-between'>
              <span>Team seats:</span>
              <span>{billingSummary.organizationData.seatCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export type { BillingSummaryData }
