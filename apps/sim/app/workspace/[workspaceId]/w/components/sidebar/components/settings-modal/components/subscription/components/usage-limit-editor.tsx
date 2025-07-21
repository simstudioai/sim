import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('UsageLimitEditor')

interface UsageLimitEditorProps {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  onLimitUpdated?: (newLimit: number) => void
}

export function UsageLimitEditor({
  currentLimit,
  canEdit,
  minimumLimit,
  onLimitUpdated,
}: UsageLimitEditorProps) {
  const [inputValue, setInputValue] = useState(currentLimit.toString())
  const [isSaving, setIsSaving] = useState(false)

  const { updateUsageLimit } = useSubscriptionStore()

  useEffect(() => {
    setInputValue(currentLimit.toString())
  }, [currentLimit])

  const handleSubmit = async () => {
    const newLimit = Number.parseInt(inputValue, 10)

    if (Number.isNaN(newLimit) || newLimit < minimumLimit) {
      setInputValue(currentLimit.toString())
      return
    }

    if (newLimit === currentLimit) {
      return
    }

    setIsSaving(true)

    try {
      const result = await updateUsageLimit(newLimit)

      if (!result.success) {
        throw new Error(result.error || 'Failed to update limit')
      }

      setInputValue(newLimit.toString())
      onLimitUpdated?.(newLimit)
    } catch (error) {
      logger.error('Failed to update usage limit', { error })
      setInputValue(currentLimit.toString())
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className='flex items-center'>
      <span className='mr-1 text-sm'>$</span>
      {canEdit ? (
        <Input
          type='number'
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSubmit}
          className='h-8 w-20 font-medium text-sm'
          min={minimumLimit}
          step='1'
          disabled={isSaving}
          autoComplete='off'
          data-form-type='other'
          name='usage-limit'
        />
      ) : (
        <span className='font-medium text-sm'>{currentLimit}</span>
      )}
    </div>
  )
}
