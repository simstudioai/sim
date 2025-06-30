import { useEffect, useState } from 'react'
import { Check, Edit2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console-logger'
import { useToast } from '@/hooks/use-toast'

const logger = createLogger('UsageLimitEditor')

interface UsageLimitEditorProps {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  onLimitUpdated: (newLimit: number) => void
}

export function UsageLimitEditor({
  currentLimit,
  canEdit,
  minimumLimit,
  onLimitUpdated,
}: UsageLimitEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [newLimit, setNewLimit] = useState(currentLimit.toString())
  const [isSaving, setIsSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setNewLimit(currentLimit.toString())
  }, [currentLimit])

  const handleSave = async () => {
    const limitValue = Number.parseFloat(newLimit)

    if (Number.isNaN(limitValue) || limitValue <= 0) {
      toast({
        title: 'Invalid Limit',
        description: 'Please enter a valid positive number',
        variant: 'destructive',
      })
      return
    }

    if (limitValue < minimumLimit) {
      toast({
        title: 'Limit Too Low',
        description: `Usage limit cannot be below your plan minimum of $${minimumLimit}`,
        variant: 'destructive',
      })
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/user/usage-limit', {
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

      onLimitUpdated(limitValue)
      setIsEditing(false)
      toast({
        title: 'Limit Updated',
        description: `Your usage limit has been set to $${limitValue}`,
      })
    } catch (error) {
      logger.error('Failed to update usage limit', { error })
      toast({
        title: 'Update Failed',
        description: error instanceof Error ? error.message : 'Failed to update usage limit',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setNewLimit(currentLimit.toString())
    setIsEditing(false)
  }

  if (!canEdit) {
    return <span className='text-muted-foreground text-xs'>${currentLimit}</span>
  }

  if (isEditing) {
    return (
      <div className='flex items-center gap-1'>
        <div className='flex items-center'>
          <span className='text-xs'>$</span>
          <Input
            type='number'
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            className='h-6 w-20 px-1 text-xs'
            min={minimumLimit}
            step='1'
            disabled={isSaving}
          />
        </div>
        <Button
          size='icon'
          variant='ghost'
          className='h-6 w-6'
          onClick={handleSave}
          disabled={isSaving}
        >
          <Check className='h-3 w-3' />
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='h-6 w-6'
          onClick={handleCancel}
          disabled={isSaving}
        >
          <X className='h-3 w-3' />
        </Button>
      </div>
    )
  }

  return (
    <div className='flex items-center gap-1'>
      <span className='text-xs'>${currentLimit}</span>
      <Button
        size='icon'
        variant='ghost'
        className='h-4 w-4 opacity-50 hover:opacity-100'
        onClick={() => setIsEditing(true)}
      >
        <Edit2 className='h-3 w-3' />
      </Button>
    </div>
  )
}
