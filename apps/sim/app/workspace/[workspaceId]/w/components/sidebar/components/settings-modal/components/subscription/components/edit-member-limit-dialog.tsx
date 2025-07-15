import { useEffect, useState } from 'react'
import { AlertTriangle, DollarSign, User } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface EditMemberLimitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: {
    userId: string
    userName: string
    userEmail: string
    currentUsage: number
    usageLimit: number
    role: string
  } | null
  onSave: (userId: string, newLimit: number) => Promise<void>
  isLoading: boolean
  planType?: string
}

export function EditMemberLimitDialog({
  open,
  onOpenChange,
  member,
  onSave,
  isLoading,
  planType = 'team',
}: EditMemberLimitDialogProps) {
  const [limitValue, setLimitValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Update limit value when member changes
  useEffect(() => {
    if (member) {
      setLimitValue(member.usageLimit.toString())
      setError(null)
    }
  }, [member])

  // Get plan minimum based on plan type
  const getPlanMinimum = (plan: string): number => {
    switch (plan) {
      case 'pro':
        return 20
      case 'team':
        return 40
      case 'enterprise':
        return 100
      default:
        return 5
    }
  }

  const planMinimum = getPlanMinimum(planType)

  const handleSave = async () => {
    if (!member) return

    const newLimit = Number.parseFloat(limitValue)

    if (Number.isNaN(newLimit) || newLimit < 0) {
      setError('Please enter a valid positive number')
      return
    }

    if (newLimit < planMinimum) {
      setError(
        `The limit cannot be below the ${planType} plan minimum of $${planMinimum.toFixed(2)}`
      )
      return
    }

    if (newLimit < member.currentUsage) {
      setError(
        `The new limit ($${newLimit.toFixed(2)}) cannot be lower than the member's current usage ($${member.currentUsage?.toFixed(2) || 0})`
      )
      return
    }

    try {
      setError(null)
      await onSave(member.userId, newLimit)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update limit')
    }
  }

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`

  if (!member) return null

  const newLimit = Number.parseFloat(limitValue) || 0
  const isIncrease = newLimit > member.usageLimit
  const isDecrease = newLimit < member.usageLimit
  const limitDifference = Math.abs(newLimit - member.usageLimit)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <User className='h-5 w-5' />
            Edit Usage Limit
          </DialogTitle>
          <DialogDescription>
            Adjust the monthly usage limit for <strong>{member.userName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          {/* Member Info */}
          <div className='flex items-center gap-3 rounded-lg bg-muted/50 p-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-medium text-primary'>
              {member.userName.charAt(0).toUpperCase()}
            </div>
            <div className='flex-1'>
              <div className='font-medium'>{member.userName}</div>
              <div className='text-muted-foreground text-sm'>{member.userEmail}</div>
            </div>
            <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>{member.role}</Badge>
          </div>

          {/* Current Usage Stats */}
          <div className='grid grid-cols-3 gap-4'>
            <div className='space-y-1'>
              <div className='text-muted-foreground text-sm'>Current Usage</div>
              <div className='font-semibold text-lg'>{formatCurrency(member.currentUsage)}</div>
            </div>
            <div className='space-y-1'>
              <div className='text-muted-foreground text-sm'>Current Limit</div>
              <div className='font-semibold text-lg'>{formatCurrency(member.usageLimit)}</div>
            </div>
            <div className='space-y-1'>
              <div className='text-muted-foreground text-sm'>Plan Minimum</div>
              <div className='font-semibold text-blue-600 text-lg'>
                {formatCurrency(planMinimum)}
              </div>
            </div>
          </div>

          {/* New Limit Input */}
          <div className='space-y-2'>
            <Label htmlFor='new-limit'>New Monthly Limit</Label>
            <div className='relative'>
              <DollarSign className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground' />
              <Input
                id='new-limit'
                type='number'
                value={limitValue}
                onChange={(e) => setLimitValue(e.target.value)}
                className='pl-9'
                min={planMinimum}
                max={10000}
                step='1'
                placeholder={planMinimum.toString()}
                autoComplete='off'
                data-form-type='other'
                name='member-usage-limit'
              />
            </div>
            <p className='text-muted-foreground text-xs'>
              Minimum limit for {planType} plan: ${planMinimum}
            </p>
          </div>

          {/* Change Indicator */}
          {limitValue && !Number.isNaN(newLimit) && limitDifference > 0 && (
            <div
              className={`rounded-lg border p-3 ${isIncrease ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}
            >
              <div
                className={`flex items-center gap-2 font-medium text-sm ${isIncrease ? 'text-green-700' : 'text-orange-700'}`}
              >
                {isIncrease ? '↗' : '↘'}
                {isIncrease ? 'Increasing' : 'Decreasing'} limit by{' '}
                {formatCurrency(limitDifference)}
              </div>
              <div className={`mt-1 text-xs ${isIncrease ? 'text-green-600' : 'text-orange-600'}`}>
                {isIncrease
                  ? 'This will give the member more usage allowance.'
                  : "This will reduce the member's usage allowance."}
              </div>
            </div>
          )}

          {/* Warning for below plan minimum */}
          {newLimit < planMinimum && newLimit > 0 && (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                The limit cannot be below the {planType} plan minimum of{' '}
                {formatCurrency(planMinimum)}.
              </AlertDescription>
            </Alert>
          )}

          {/* Warning for decreasing below current usage */}
          {newLimit < member.currentUsage && newLimit >= planMinimum && (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                The new limit is below the member's current usage. The limit must be at least{' '}
                {formatCurrency(member.currentUsage)}.
              </AlertDescription>
            </Alert>
          )}

          {/* Error Display */}
          {error && (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !limitValue || Number.isNaN(newLimit) || newLimit < planMinimum}
          >
            {isLoading ? 'Updating...' : 'Update Limit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
