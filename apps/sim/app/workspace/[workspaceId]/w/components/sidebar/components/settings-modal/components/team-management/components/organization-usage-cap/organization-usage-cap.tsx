'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, DollarSign, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('OrganizationUsageCap')

interface OrganizationUsageCapProps {
  hasAdminAccess: boolean
}

export function OrganizationUsageCap({ hasAdminAccess }: OrganizationUsageCapProps) {
  const { data: activeOrg } = useActiveOrganization()
  const [usageLimit, setUsageLimit] = useState<string>('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateSuccess, setUpdateSuccess] = useState(false)

  const {
    organizationBillingData: billingData,
    loadOrganizationBillingData,
    isLoadingOrgBilling,
  } = useOrganizationStore()

  const { getSubscriptionStatus } = useSubscriptionStore()
  const subscription = getSubscriptionStatus()

  // Load billing data on mount
  useEffect(() => {
    if (activeOrg?.id) {
      loadOrganizationBillingData(activeOrg.id)
    }
  }, [activeOrg?.id, loadOrganizationBillingData])

  // Handle success message timeout
  useEffect(() => {
    if (updateSuccess) {
      const timeoutId = setTimeout(() => {
        setUpdateSuccess(false)
      }, 3000)

      return () => clearTimeout(timeoutId)
    }
  }, [updateSuccess])

  // Set initial value from billing data
  useEffect(() => {
    if (billingData?.totalUsageLimit) {
      setUsageLimit(billingData.totalUsageLimit.toString())
    } else if (billingData?.minimumBillingAmount) {
      // Default to minimum if no cap is set
      setUsageLimit(billingData.minimumBillingAmount.toString())
    }
  }, [billingData])

  const handleUpdateLimit = useCallback(async () => {
    if (!activeOrg?.id || !hasAdminAccess) return

    const newLimit = Number.parseFloat(usageLimit)
    if (Number.isNaN(newLimit) || newLimit <= 0) {
      setUpdateError('Please enter a valid amount greater than 0')
      return
    }

    // Validate against minimum
    const minimum = billingData?.minimumBillingAmount || 0
    if (newLimit < minimum) {
      setUpdateError(
        `Usage cap cannot be less than the minimum billing amount of $${minimum.toFixed(2)}`
      )
      return
    }

    try {
      setIsUpdating(true)
      setUpdateError(null)
      setUpdateSuccess(false)

      const response = await fetch('/api/usage-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: 'organization',
          organizationId: activeOrg.id,
          limit: newLimit,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update usage cap')
      }

      setUpdateSuccess(true)
      // Reload billing data to reflect changes
      await loadOrganizationBillingData(activeOrg.id)

      logger.info('Successfully updated organization usage cap', {
        organizationId: activeOrg.id,
        newLimit,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update usage cap'
      setUpdateError(errorMessage)
      logger.error('Failed to update organization usage cap', {
        error,
        organizationId: activeOrg.id,
        newLimit,
      })
    } finally {
      setIsUpdating(false)
    }
  }, [activeOrg?.id, hasAdminAccess, usageLimit, billingData, loadOrganizationBillingData])

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`

  if (isLoadingOrgBilling) {
    return (
      <Card className='border-0 shadow-sm'>
        <CardHeader>
          <Skeleton className='h-5 w-32' />
          <Skeleton className='mt-2 h-4 w-64' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-10 w-full' />
        </CardContent>
      </Card>
    )
  }

  if (!billingData) {
    return null
  }

  const currentUsage = billingData.totalCurrentUsage || 0
  const minimumBilling = billingData.minimumBillingAmount || 0
  const currentCap = billingData.totalUsageLimit || minimumBilling
  const percentUsed = currentCap > 0 ? (currentUsage / currentCap) * 100 : 0
  const isNearLimit = percentUsed >= 80
  const isOverLimit = currentUsage >= currentCap

  return (
    <div className='space-y-4'>
      {/* Current Usage Overview */}
      <Card className='border-0 shadow-sm'>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <DollarSign className='h-4 w-4' />
            Team Usage Overview
          </CardTitle>
          <CardDescription>Monitor and control your team's pooled usage</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {/* Usage Stats */}
          <div className='grid gap-4 sm:grid-cols-3'>
            <div>
              <div className='text-muted-foreground text-sm'>Current Usage</div>
              <div className='mt-1 font-semibold text-2xl'>{formatCurrency(currentUsage)}</div>
            </div>
            <div>
              <div className='text-muted-foreground text-sm'>Usage Cap</div>
              <div className='mt-1 font-semibold text-2xl'>{formatCurrency(currentCap)}</div>
            </div>
            <div>
              <div className='text-muted-foreground text-sm'>Minimum Billing</div>
              <div className='mt-1 font-medium text-lg text-muted-foreground'>
                {formatCurrency(minimumBilling)}
              </div>
              <div className='text-muted-foreground text-xs'>
                {billingData.seatsCount} seats × $
                {billingData.subscriptionPlan === 'team' ? '40' : '200'}
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className='space-y-2'>
            <div className='flex justify-between text-sm'>
              <span className='text-muted-foreground'>Usage Progress</span>
              <span
                className={
                  isOverLimit
                    ? 'font-medium text-red-600'
                    : isNearLimit
                      ? 'font-medium text-orange-600'
                      : ''
                }
              >
                {percentUsed.toFixed(1)}%
              </span>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div
                className={`h-full transition-all ${
                  isOverLimit ? 'bg-red-600' : isNearLimit ? 'bg-orange-600' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(percentUsed, 100)}%` }}
              />
            </div>
          </div>

          {/* Alerts */}
          {isOverLimit && (
            <Alert variant='destructive' className='mt-4'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>
                Your team has exceeded the usage cap. Team members will be unable to use the service
                until the cap is increased or usage is reduced.
              </AlertDescription>
            </Alert>
          )}

          {isNearLimit && !isOverLimit && (
            <Alert className='mt-4 border-orange-200 bg-orange-50'>
              <Info className='h-4 w-4 text-orange-600' />
              <AlertDescription className='text-orange-800'>
                Your team is approaching the usage cap. Consider increasing the limit to avoid
                service interruption.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Usage Cap Settings */}
      {hasAdminAccess && (
        <Card className='border-0 shadow-sm'>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>Usage Cap Settings</CardTitle>
            <CardDescription>
              Set a maximum usage limit for your entire team. This cap applies to pooled usage
              across all members.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='usage-cap'>Team Usage Cap ($)</Label>
              <div className='flex gap-2'>
                <Input
                  id='usage-cap'
                  type='number'
                  min={minimumBilling}
                  step='10'
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value)}
                  placeholder={`Minimum: ${formatCurrency(minimumBilling)}`}
                  disabled={isUpdating}
                  className='max-w-xs'
                />
                <Button onClick={handleUpdateLimit} disabled={isUpdating || !usageLimit}>
                  {isUpdating ? 'Updating...' : 'Update Cap'}
                </Button>
              </div>
              <p className='text-muted-foreground text-sm'>
                The usage cap must be at least {formatCurrency(minimumBilling)} (your minimum
                billing amount based on {billingData.seatsCount} licensed seats).
              </p>
            </div>

            {updateError && (
              <Alert variant='destructive'>
                <AlertCircle className='h-4 w-4' />
                <AlertDescription>{updateError}</AlertDescription>
              </Alert>
            )}

            {updateSuccess && (
              <Alert className='border-green-200 bg-green-50'>
                <Info className='h-4 w-4 text-green-600' />
                <AlertDescription className='text-green-800'>
                  Usage cap updated successfully!
                </AlertDescription>
              </Alert>
            )}

            {/* Info Box */}
            <Alert>
              <Info className='h-4 w-4' />
              <AlertDescription className='space-y-2'>
                <p>
                  <strong>How team billing works:</strong>
                </p>
                <ul className='ml-4 list-disc space-y-1 text-sm'>
                  <li>
                    Your team is billed a minimum of {formatCurrency(minimumBilling)} per month for{' '}
                    {billingData.seatsCount} licensed seats
                  </li>
                  <li>All team member usage is pooled together</li>
                  <li>
                    When pooled usage exceeds the cap, all members are blocked from using the
                    service
                  </li>
                  <li>You can set the cap higher than the minimum to allow for overages</li>
                  <li>
                    Any usage beyond the minimum is billed as overage at the end of the billing
                    period
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
