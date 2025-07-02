import { useEffect, useState } from 'react'
import { Check, Edit2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console-logger'

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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNewLimit(currentLimit.toString())
  }, [currentLimit])

  const handleSave = async () => {
    const limitValue = Number.parseFloat(newLimit)

    if (Number.isNaN(limitValue) || limitValue <= 0) {
      setError('Please enter a valid positive number')
      return
    }

    if (limitValue < minimumLimit) {
      setError(`Usage limit cannot be below your plan minimum of $${minimumLimit}`)
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/users/me/usage-limit', {
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
    } catch (error) {
      logger.error('Failed to update usage limit', { error })
      setError(error instanceof Error ? error.message : 'Failed to update usage limit')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setNewLimit(currentLimit.toString())
    setIsEditing(false)
    setError(null)
  }

  if (!canEdit) {
    return <span className='text-muted-foreground text-xs'>${currentLimit}</span>
  }

  if (isEditing) {
    return (
      <div className='flex flex-col gap-1'>
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
        {error && <div className='text-destructive text-xs'>{error}</div>}
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
