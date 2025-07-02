import { useEffect, useState } from 'react'
import { AlertCircle, Check, DollarSign, Edit3, TrendingUp, Users, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useActiveOrganization } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'

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
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editingLimit, setEditingLimit] = useState<string>('')
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

  const handleEditLimit = (userId: string, currentLimit: number) => {
    setEditingUserId(userId)
    setEditingLimit(currentLimit.toString())
  }

  const handleSaveLimit = async (userId: string) => {
    if (!activeOrg?.id || !editingLimit) return

    const newLimit = Number.parseFloat(editingLimit)

    if (Number.isNaN(newLimit) || newLimit < 0) {
      alert('Please enter a valid limit amount')
      return
    }

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
      setEditingUserId(null)
      setEditingLimit('')
    } catch (error) {
      logger.error('Failed to update usage limit', { error })
      alert(error instanceof Error ? error.message : 'Failed to update usage limit')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingUserId(null)
    setEditingLimit('')
  }

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString()
  }

  if (isLoading) {
    return (
      <div className='space-y-4'>
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
    <div className='space-y-6'>
      {/* Organization Overview */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>Total Usage</CardTitle>
            <DollarSign className='h-4 w-4 text-muted-foreground' />
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>
              {formatCurrency(billingData.totalCurrentUsage)}
            </div>
            <p className='text-muted-foreground text-xs'>
              of {formatCurrency(billingData.totalUsageLimit)} limit
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>Team Seats</CardTitle>
            <Users className='h-4 w-4 text-muted-foreground' />
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{billingData.usedSeats}</div>
            <p className='text-muted-foreground text-xs'>of {billingData.totalSeats} available</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>Avg Usage</CardTitle>
            <TrendingUp className='h-4 w-4 text-muted-foreground' />
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>
              {formatCurrency(billingData.averageUsagePerMember)}
            </div>
            <p className='text-muted-foreground text-xs'>per member</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>Alerts</CardTitle>
            <AlertCircle className='h-4 w-4 text-muted-foreground' />
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl text-destructive'>{membersOverLimit}</div>
            <p className='text-muted-foreground text-xs'>
              over limit, {membersNearLimit} near limit
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {membersOverLimit > 0 && (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertTitle>Members Over Limit</AlertTitle>
          <AlertDescription>
            {membersOverLimit} team {membersOverLimit === 1 ? 'member has' : 'members have'}{' '}
            exceeded their usage limits. Consider increasing their limits or upgrading your plan.
          </AlertDescription>
        </Alert>
      )}

      {/* Member Usage Table */}
      <Card>
        <CardHeader>
          <CardTitle>Team Member Usage</CardTitle>
          <CardDescription>Monitor and manage individual team member usage limits</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Last Active</TableHead>
                {hasAdminAccess && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {billingData.members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <div>
                      <div className='font-medium'>{member.userName}</div>
                      <div className='text-muted-foreground text-sm'>{member.userEmail}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                      {member.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatCurrency(member.currentUsage)}</TableCell>
                  <TableCell>
                    {editingUserId === member.userId ? (
                      <div className='flex items-center space-x-2'>
                        <Input
                          type='number'
                          value={editingLimit}
                          onChange={(e) => setEditingLimit(e.target.value)}
                          className='w-20'
                          min='0'
                          step='0.01'
                        />
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => handleSaveLimit(member.userId)}
                          disabled={isUpdating}
                        >
                          <Check className='h-3 w-3' />
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={handleCancelEdit}
                          disabled={isUpdating}
                        >
                          <X className='h-3 w-3' />
                        </Button>
                      </div>
                    ) : (
                      formatCurrency(member.usageLimit)
                    )}
                  </TableCell>
                  <TableCell className='w-32'>
                    <div className='space-y-1'>
                      <Progress
                        value={Math.min(member.percentUsed, 100)}
                        className={`h-2 ${
                          member.isOverLimit
                            ? 'bg-destructive/20'
                            : member.percentUsed >= 80
                              ? 'bg-yellow-500/20'
                              : ''
                        }`}
                      />
                      <div className='text-muted-foreground text-xs'>
                        {member.percentUsed.toFixed(1)}%
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(member.lastActive)}</TableCell>
                  {hasAdminAccess && (
                    <TableCell>
                      {editingUserId !== member.userId && (
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => handleEditLimit(member.userId, member.usageLimit)}
                          disabled={isUpdating}
                        >
                          <Edit3 className='h-3 w-3' />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Billing Period Info */}
      {billingData.billingPeriodStart && billingData.billingPeriodEnd && (
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Current Billing Period</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-muted-foreground text-sm'>
              {formatDate(billingData.billingPeriodStart)} -{' '}
              {formatDate(billingData.billingPeriodEnd)}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
