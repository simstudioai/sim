import { useEffect, useState } from 'react'
import { AlertCircle, BarChart3, DollarSign, Settings2, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { EditMemberLimitDialog } from './edit-member-limit-dialog'

const logger = createLogger('TeamUsageOverview')

interface MemberUsageData {
  userId: string
  userName: string
  userEmail: string
  currentUsage: number
  usageLimit: number
  percentUsed: number
  isOverLimit: boolean
  role: string
  joinedAt: string
  lastActive: string | null
}

interface OrganizationBillingData {
  organizationId: string
  organizationName: string
  subscriptionPlan: string
  subscriptionStatus: string
  totalSeats: number
  usedSeats: number
  totalCurrentUsage: number
  totalUsageLimit: number
  averageUsagePerMember: number
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  members: MemberUsageData[]
}

interface TeamUsageOverviewProps {
  hasAdminAccess: boolean
}

export function TeamUsageOverview({ hasAdminAccess }: TeamUsageOverviewProps) {
  const { data: activeOrg } = useActiveOrganization()
  const [billingData, setBillingData] = useState<OrganizationBillingData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [selectedMember, setSelectedMember] = useState<MemberUsageData | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    if (activeOrg?.id) {
      fetchBillingData()
    }
  }, [activeOrg?.id])

  const fetchBillingData = async () => {
    if (!activeOrg?.id) return

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/organizations/${activeOrg.id}/billing`)

      if (!response.ok) {
        throw new Error('Failed to fetch organization billing data')
      }

      const result = await response.json()
      setBillingData(result.data)
    } catch (error) {
      logger.error('Failed to fetch billing data', { error })
      setError('Failed to load team usage data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEditLimit = (member: MemberUsageData) => {
    setSelectedMember(member)
    setEditDialogOpen(true)
  }

  const handleSaveLimit = async (userId: string, newLimit: number) => {
    if (!activeOrg?.id) return

    try {
      setIsUpdating(true)

      const response = await fetch(
        `/api/organizations/${activeOrg.id}/billing/members/${userId}/usage-limit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ limit: newLimit }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update usage limit')
      }

      // Refresh data
      await fetchBillingData()
    } catch (error) {
      logger.error('Failed to update usage limit', { error })
      throw error
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false)
    setSelectedMember(null)
  }

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString()
  }

  if (isLoading) {
    return (
      <div className='space-y-6'>
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-64 w-full' />
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

  const membersOverLimit = billingData.members.filter((m) => m.isOverLimit).length
  const membersNearLimit = billingData.members.filter(
    (m) => !m.isOverLimit && m.percentUsed >= 80
  ).length

  return (
    <div className='space-y-8'>
      {/* Organization Overview */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card className='relative overflow-hidden border-0 bg-gradient-to-br from-blue-50 to-blue-100/50 shadow-sm'>
          <CardHeader className='pb-4'>
            <div className='flex items-center justify-between'>
              <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100'>
                <DollarSign className='h-5 w-5 text-blue-600' />
              </div>
              <div className='text-right'>
                <CardTitle className='font-medium text-blue-900 text-sm'>Total Usage</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='space-y-2'>
              <div className='font-bold text-2xl text-blue-900'>
                {formatCurrency(billingData.totalCurrentUsage)}
              </div>
              <p className='text-blue-700 text-xs'>
                of {formatCurrency(billingData.totalUsageLimit)} limit
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className='relative overflow-hidden border-0 bg-gradient-to-br from-green-50 to-green-100/50 shadow-sm'>
          <CardHeader className='pb-4'>
            <div className='flex items-center justify-between'>
              <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-green-100'>
                <Users className='h-5 w-5 text-green-600' />
              </div>
              <div className='text-right'>
                <CardTitle className='font-medium text-green-900 text-sm'>Team Seats</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='space-y-2'>
              <div className='font-bold text-2xl text-green-900'>{billingData.usedSeats}</div>
              <p className='text-green-700 text-xs'>of {billingData.totalSeats} available</p>
            </div>
          </CardContent>
        </Card>

        <Card className='relative overflow-hidden border-0 bg-gradient-to-br from-purple-50 to-purple-100/50 shadow-sm'>
          <CardHeader className='pb-4'>
            <div className='flex items-center justify-between'>
              <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100'>
                <BarChart3 className='h-5 w-5 text-purple-600' />
              </div>
              <div className='text-right'>
                <CardTitle className='font-medium text-purple-900 text-sm'>Avg Usage</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='space-y-2'>
              <div className='font-bold text-2xl text-purple-900'>
                {formatCurrency(billingData.averageUsagePerMember)}
              </div>
              <p className='text-purple-700 text-xs'>per member</p>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`relative overflow-hidden border-0 shadow-sm ${
            membersOverLimit > 0
              ? 'bg-gradient-to-br from-red-50 to-red-100/50'
              : 'bg-gradient-to-br from-slate-50 to-slate-100/50'
          }`}
        >
          <CardHeader className='pb-4'>
            <div className='flex items-center justify-between'>
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  membersOverLimit > 0 ? 'bg-red-100' : 'bg-slate-100'
                }`}
              >
                <AlertCircle
                  className={`h-5 w-5 ${membersOverLimit > 0 ? 'text-red-600' : 'text-slate-600'}`}
                />
              </div>
              <div className='text-right'>
                <CardTitle
                  className={`font-medium text-sm ${
                    membersOverLimit > 0 ? 'text-red-900' : 'text-slate-900'
                  }`}
                >
                  Status
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='space-y-2'>
              <div
                className={`font-bold text-2xl ${
                  membersOverLimit > 0 ? 'text-red-900' : 'text-slate-900'
                }`}
              >
                {membersOverLimit === 0 ? '✓' : membersOverLimit}
              </div>
              <p className={`text-xs ${membersOverLimit > 0 ? 'text-red-700' : 'text-slate-700'}`}>
                {membersOverLimit === 0
                  ? 'All members within limits'
                  : `${membersOverLimit} over limit, ${membersNearLimit} near limit`}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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
        <CardHeader className='pb-6'>
          <div>
            <CardTitle className='text-lg'>Team Member Usage</CardTitle>
            <CardDescription className='mt-2'>
              Monitor and manage individual team member usage limits
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className='p-0'>
          <div className='overflow-hidden rounded-lg border'>
            {/* Table Header */}
            <div className='bg-muted/30 px-6 py-4'>
              <div className='grid grid-cols-12 gap-4 font-medium text-muted-foreground text-sm'>
                <div className='col-span-4'>Member</div>
                <div className='col-span-2 hidden text-center sm:block'>Usage</div>
                <div className='col-span-2 hidden text-center sm:block'>Limit</div>
                <div className='col-span-2 text-center'>Progress</div>
                <div className='col-span-1 hidden text-center lg:block'>Last Active</div>
                <div className='col-span-1 text-center' />
              </div>
            </div>

            {/* Table Body */}
            <div className='divide-y divide-border'>
              {billingData.members.map((member) => (
                <div
                  key={member.userId}
                  className='group px-6 py-6 transition-colors hover:bg-muted/30'
                >
                  <div className='grid grid-cols-12 items-center gap-4'>
                    {/* Member Info */}
                    <div className='col-span-4'>
                      <div className='flex items-center gap-4'>
                        <div className='flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary'>
                          {member.userName.charAt(0).toUpperCase()}
                        </div>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-3'>
                            <div className='truncate font-medium'>{member.userName}</div>
                            <Badge
                              variant={member.role === 'owner' ? 'default' : 'secondary'}
                              className='text-xs'
                            >
                              {member.role}
                            </Badge>
                          </div>
                          <div className='mt-1 truncate text-muted-foreground text-sm'>
                            {member.userEmail}
                          </div>
                        </div>
                      </div>

                      {/* Mobile-only usage info */}
                      <div className='mt-4 grid grid-cols-2 gap-4 sm:hidden'>
                        <div>
                          <div className='text-muted-foreground text-xs'>Usage</div>
                          <div className='font-medium'>{formatCurrency(member.currentUsage)}</div>
                        </div>
                        <div>
                          <div className='text-muted-foreground text-xs'>Limit</div>
                          <div className='font-medium'>{formatCurrency(member.usageLimit)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Usage - Desktop */}
                    <div className='col-span-2 hidden text-center sm:block'>
                      <div className='font-medium'>{formatCurrency(member.currentUsage)}</div>
                    </div>

                    {/* Limit - Desktop */}
                    <div className='col-span-2 hidden text-center sm:block'>
                      <div className='font-medium'>{formatCurrency(member.usageLimit)}</div>
                    </div>

                    {/* Progress */}
                    <div className='col-span-2'>
                      <div className='space-y-2'>
                        <Progress
                          value={Math.min(member.percentUsed, 100)}
                          className={`h-2 ${
                            member.isOverLimit
                              ? '[&>div]:bg-red-500'
                              : member.percentUsed >= 80
                                ? '[&>div]:bg-yellow-500'
                                : '[&>div]:bg-green-500'
                          }`}
                        />
                        <div
                          className={`text-center font-medium text-sm ${
                            member.isOverLimit
                              ? 'text-red-600'
                              : member.percentUsed >= 80
                                ? 'text-yellow-600'
                                : 'text-green-600'
                          }`}
                        >
                          {member.percentUsed.toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {/* Last Active - Desktop */}
                    <div className='col-span-1 hidden text-center lg:block'>
                      <div className='text-muted-foreground text-sm'>
                        {formatDate(member.lastActive)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className='col-span-1 text-center'>
                      {hasAdminAccess && (
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => handleEditLimit(member)}
                          disabled={isUpdating}
                          className='opacity-0 transition-opacity group-hover:opacity-100 sm:opacity-100'
                          title='Edit usage limit'
                        >
                          <Settings2 className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Period Info */}
      {billingData.billingPeriodStart && billingData.billingPeriodEnd && (
        <Card className='border-0 bg-muted/30 shadow-sm'>
          <CardContent className='flex items-center gap-4 pt-6'>
            <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100'>
              <DollarSign className='h-5 w-5 text-slate-600' />
            </div>
            <div>
              <div className='font-medium text-slate-900 text-sm'>Current Billing Period</div>
              <p className='mt-1 text-slate-600 text-xs'>
                {formatDate(billingData.billingPeriodStart)} -{' '}
                {formatDate(billingData.billingPeriodEnd)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Member Limit Dialog */}
      <EditMemberLimitDialog
        open={editDialogOpen}
        onOpenChange={handleCloseEditDialog}
        member={selectedMember}
        onSave={handleSaveLimit}
        isLoading={isUpdating}
      />
    </div>
  )
}
