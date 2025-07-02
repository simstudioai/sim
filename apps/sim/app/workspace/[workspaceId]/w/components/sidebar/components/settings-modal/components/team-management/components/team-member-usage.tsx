import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Check, Edit2, TrendingUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('TeamMemberUsage')

interface TeamMemberUsageProps {
  organizationId: string
  isAdmin: boolean
}

interface TeamMemberUsage {
  userId: string
  userName: string
  userEmail: string
  currentLimit: number
  totalCost: number
  lastActive: Date | null
  limitSetBy: string | null
  limitUpdatedAt: Date | null
}

export function TeamMemberUsage({ organizationId, isAdmin }: TeamMemberUsageProps) {
  const [teamUsage, setTeamUsage] = useState<TeamMemberUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [editingMember, setEditingMember] = useState<string | null>(null)
  const [newLimit, setNewLimit] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTeamUsage()
  }, [organizationId])

  const fetchTeamUsage = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/team/${organizationId}/usage-limits`)

      if (!response.ok) {
        throw new Error('Failed to fetch team usage data')
      }

      const data = await response.json()
      setTeamUsage(data.teamUsageLimits)
    } catch (error) {
      logger.error('Failed to fetch team usage', { error })
      setError('Failed to load team usage data')
    } finally {
      setLoading(false)
    }
  }

  const handleEditLimit = (member: TeamMemberUsage) => {
    setEditingMember(member.userId)
    setNewLimit(member.currentLimit.toString())
  }

  const handleSaveLimit = async (userId: string) => {
    const limitValue = Number.parseFloat(newLimit)

    if (Number.isNaN(limitValue) || limitValue <= 0) {
      setError('Please enter a valid positive number')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/team/${organizationId}/usage-limits/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limit: limitValue }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update limit')
      }

      // Update local state
      setTeamUsage((prev) =>
        prev.map((member) =>
          member.userId === userId
            ? { ...member, currentLimit: limitValue, limitUpdatedAt: new Date() }
            : member
        )
      )

      setEditingMember(null)
    } catch (error) {
      logger.error('Failed to update member usage limit', { error })
      setError(error instanceof Error ? error.message : 'Failed to update usage limit')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingMember(null)
    setNewLimit('')
    setError(null)
  }

  if (loading) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <TrendingUp className='h-4 w-4' />
          <h4 className='font-medium'>Team Usage Overview</h4>
        </div>
        <div className='space-y-3'>
          {[1, 2, 3].map((i) => (
            <div key={i} className='animate-pulse'>
              <div className='h-16 rounded bg-muted' />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (teamUsage.length === 0) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <TrendingUp className='h-4 w-4' />
          <h4 className='font-medium'>Team Usage Overview</h4>
        </div>
        <div className='p-4 text-center text-muted-foreground text-sm'>
          No usage data available for team members
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-2'>
        <TrendingUp className='h-4 w-4' />
        <h4 className='font-medium'>Team Usage Overview</h4>
      </div>

      {error && (
        <div className='rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm'>
          {error}
        </div>
      )}

      <div className='space-y-3'>
        {teamUsage.map((member) => {
          const usagePercent =
            member.currentLimit > 0
              ? Math.min((member.totalCost / member.currentLimit) * 100, 100)
              : 0
          const isNearLimit = usagePercent >= 80
          const isOverLimit = member.totalCost >= member.currentLimit

          return (
            <div key={member.userId} className='space-y-3 rounded-lg border p-4'>
              <div className='flex items-start justify-between'>
                <div>
                  <div className='font-medium'>{member.userName}</div>
                  <div className='text-muted-foreground text-sm'>{member.userEmail}</div>
                  {member.lastActive && (
                    <div className='text-muted-foreground text-xs'>
                      Last active {formatDistanceToNow(new Date(member.lastActive))} ago
                    </div>
                  )}
                </div>

                <div className='text-right'>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm'>${member.totalCost.toFixed(2)} /</span>
                    {editingMember === member.userId ? (
                      <div className='flex items-center gap-1'>
                        <div className='flex items-center'>
                          <span className='text-sm'>$</span>
                          <Input
                            type='number'
                            value={newLimit}
                            onChange={(e) => setNewLimit(e.target.value)}
                            className='h-6 w-20 px-1 text-sm'
                            min='1'
                            step='1'
                            disabled={isSaving}
                          />
                        </div>
                        <Button
                          size='icon'
                          variant='ghost'
                          className='h-6 w-6'
                          onClick={() => handleSaveLimit(member.userId)}
                          disabled={isSaving}
                        >
                          <Check className='h-3 w-3' />
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          className='h-6 w-6'
                          onClick={handleCancelEdit}
                          disabled={isSaving}
                        >
                          <X className='h-3 w-3' />
                        </Button>
                      </div>
                    ) : (
                      <div className='flex items-center gap-1'>
                        <span className='text-sm'>${member.currentLimit}</span>
                        {isAdmin && (
                          <Button
                            size='icon'
                            variant='ghost'
                            className='h-4 w-4 opacity-50 hover:opacity-100'
                            onClick={() => handleEditLimit(member)}
                          >
                            <Edit2 className='h-3 w-3' />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {member.limitUpdatedAt && member.limitSetBy && (
                    <div className='mt-1 text-muted-foreground text-xs'>
                      Limit set {formatDistanceToNow(new Date(member.limitUpdatedAt))} ago
                    </div>
                  )}
                </div>
              </div>

              <div className='space-y-1'>
                <div className='flex justify-between text-xs'>
                  <span>Usage</span>
                  <span
                    className={
                      isOverLimit ? 'text-destructive' : isNearLimit ? 'text-amber-600' : ''
                    }
                  >
                    {usagePercent.toFixed(1)}%
                  </span>
                </div>
                <Progress
                  value={usagePercent}
                  className={`h-2 ${
                    isOverLimit
                      ? 'bg-muted [&>*]:bg-destructive'
                      : isNearLimit
                        ? 'bg-muted [&>*]:bg-amber-500'
                        : '[&>*]:bg-primary'
                  }`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
