import { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useOrganizationStore } from '@/stores/organization'

const logger = createLogger('TeamUsage')

interface TeamUsageProps {
  hasAdminAccess: boolean
}

export function TeamUsage({ hasAdminAccess }: TeamUsageProps) {
  const { data: activeOrg } = useActiveOrganization()

  const {
    organizationBillingData: billingData,
    loadOrganizationBillingData,
    isLoadingOrgBilling,
    error,
  } = useOrganizationStore()

  useEffect(() => {
    if (activeOrg?.id) {
      loadOrganizationBillingData(activeOrg.id)
    }
  }, [activeOrg?.id, loadOrganizationBillingData])

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString()
  }

  if (isLoadingOrgBilling) {
    return (
      <div className='space-y-6'>
        {/* Table Skeleton */}
        <Card className='border-0 shadow-sm'>
          <CardContent className='p-0'>
            <div className='overflow-hidden rounded-lg border'>
              {/* Table Header Skeleton */}
              <div className='bg-muted/30 px-6 py-4'>
                <div className='grid grid-cols-12 gap-4'>
                  <div className='col-span-4'>
                    <Skeleton className='h-3 w-16' />
                  </div>
                  <div className='col-span-2 flex justify-center'>
                    <Skeleton className='h-3 w-8' />
                  </div>
                  <div className='col-span-2 hidden text-right sm:block'>
                    <Skeleton className='ml-auto h-3 w-12' />
                  </div>
                  <div className='col-span-2 hidden text-right sm:block'>
                    <Skeleton className='ml-auto h-3 w-12' />
                  </div>
                  <div className='col-span-1 hidden text-center lg:block'>
                    <Skeleton className='mx-auto h-3 w-12' />
                  </div>
                  <div className='col-span-1' />
                </div>
              </div>

              {/* Table Body Skeleton */}
              <div className='divide-y divide-border'>
                {[...Array(3)].map((_, index) => (
                  <div key={index} className='px-6 py-4'>
                    <div className='grid grid-cols-11 items-center gap-4'>
                      {/* Member Info Skeleton */}
                      <div className='col-span-4'>
                        <div className='flex items-center gap-3'>
                          <Skeleton className='h-8 w-8 rounded-full' />
                          <div className='min-w-0 flex-1'>
                            <Skeleton className='h-4 w-24' />
                            <Skeleton className='mt-1 h-3 w-32' />
                          </div>
                        </div>

                        {/* Mobile-only usage info skeleton */}
                        <div className='mt-3 grid grid-cols-2 gap-4 sm:hidden'>
                          <div>
                            <Skeleton className='h-3 w-10' />
                            <Skeleton className='mt-1 h-4 w-16' />
                          </div>
                          <div>
                            <Skeleton className='h-3 w-8' />
                            <Skeleton className='mt-1 h-4 w-16' />
                          </div>
                        </div>
                      </div>

                      {/* Role Skeleton */}
                      <div className='col-span-2 flex justify-center'>
                        <Skeleton className='h-4 w-12' />
                      </div>

                      {/* Usage - Desktop Skeleton */}
                      <div className='col-span-2 hidden text-right sm:block'>
                        <Skeleton className='ml-auto h-4 w-16' />
                      </div>

                      {/* Limit - Desktop Skeleton */}
                      <div className='col-span-2 hidden text-right sm:block'>
                        <Skeleton className='ml-auto h-4 w-16' />
                      </div>

                      {/* Last Active - Desktop Skeleton */}
                      <div className='col-span-1 hidden text-center lg:block'>
                        <Skeleton className='mx-auto h-3 w-16' />
                      </div>

                      {/* Actions Skeleton */}
                      <div className='col-span-1 text-center'>
                        <Skeleton className='mx-auto h-8 w-8' />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant='destructive'>
        <AlertCircle className='h-4 w-4' />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!billingData) {
    return (
      <Alert>
        <AlertCircle className='h-4 w-4' />
        <AlertTitle>No Data</AlertTitle>
        <AlertDescription>No billing data available for this organization.</AlertDescription>
      </Alert>
    )
  }

  const membersOverLimit = billingData.members?.filter((m) => m.isOverLimit).length || 0
  const membersNearLimit =
    billingData.members?.filter((m) => !m.isOverLimit && m.percentUsed >= 80).length || 0

  return (
    <div className='space-y-6'>
      {/* Alerts */}
      {membersOverLimit > 0 && (
        <div className='rounded-lg border border-orange-200 bg-orange-50 p-6'>
          <div className='flex items-start gap-4'>
            <div className='flex h-9 w-9 items-center justify-center rounded-full bg-orange-100'>
              <AlertCircle className='h-5 w-5 text-orange-600' />
            </div>
            <div className='flex-1'>
              <h4 className='font-medium text-orange-800 text-sm'>Usage Limits Exceeded</h4>
              <p className='mt-2 text-orange-700 text-sm'>
                {membersOverLimit} team {membersOverLimit === 1 ? 'member has' : 'members have'}{' '}
                exceeded their usage limits. Consider increasing their limits below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Member Usage Table */}
      <Card className='border-0 shadow-sm'>
        <CardContent className='p-0'>
          <div className='overflow-hidden rounded-lg border'>
            {/* Table Header */}
            <div className='bg-muted/30 px-6 py-4'>
              <div className='grid grid-cols-11 gap-4 font-medium text-muted-foreground text-xs'>
                <div className='col-span-4'>Member</div>
                <div className='col-span-2 text-center'>Role</div>
                <div className='col-span-2 hidden text-right sm:block'>Usage</div>
                <div className='col-span-2 hidden text-right sm:block'>Pool Contribution</div>
                <div className='col-span-1 hidden text-center lg:block'>Active</div>
              </div>
            </div>

            {/* Table Body */}
            <div className='divide-y divide-border'>
              {billingData.members && billingData.members.length > 0 ? (
                billingData.members.map((member) => (
                  <div
                    key={member.userId}
                    className='group px-6 py-4 transition-colors hover:bg-muted/30'
                  >
                    <div className='grid grid-cols-11 items-center gap-4'>
                      {/* Member Info */}
                      <div className='col-span-4'>
                        <div className='flex items-center gap-3'>
                          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-xs'>
                            {member.userName.charAt(0).toUpperCase()}
                          </div>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate font-medium text-sm'>{member.userName}</div>
                            <div className='mt-0.5 truncate text-muted-foreground text-xs'>
                              {member.userEmail}
                            </div>
                          </div>
                        </div>

                        {/* Mobile-only usage info */}
                        <div className='mt-3 sm:hidden'>
                          <div className='text-muted-foreground text-xs'>Contributing to pool</div>
                          <div className='font-medium text-sm'>
                            {formatCurrency(member.currentUsage)}
                          </div>
                        </div>
                      </div>

                      {/* Role */}
                      <div className='col-span-2 flex justify-center'>
                        <Badge variant='secondary' className='text-xs'>
                          {member.role}
                        </Badge>
                      </div>

                      {/* Usage - Desktop */}
                      <div className='col-span-2 hidden text-right sm:block'>
                        <div className='font-medium text-sm'>
                          {formatCurrency(member.currentUsage)}
                        </div>
                      </div>

                      {/* Pool Contribution - Desktop */}
                      <div className='col-span-2 hidden text-right sm:block'>
                        <div className='font-medium text-sm'>
                          {formatCurrency(member.currentUsage)}
                        </div>
                        <div className='text-muted-foreground text-xs'>of team pool</div>
                      </div>

                      {/* Last Active - Desktop */}
                      <div className='col-span-1 hidden text-center lg:block'>
                        <div className='text-muted-foreground text-xs'>
                          {formatDate(member.lastActive)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className='px-6 py-8 text-center'>
                  <div className='text-muted-foreground text-sm'>No team members found.</div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
