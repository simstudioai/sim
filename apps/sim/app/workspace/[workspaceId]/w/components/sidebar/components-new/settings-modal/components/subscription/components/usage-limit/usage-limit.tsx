'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useUsageLimits } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/hooks'

const logger = createLogger('UsageLimit')

interface UsageLimitProps {
  currentLimit: number
  currentUsage: number
  canEdit: boolean
  minimumLimit: number
  onLimitUpdated?: (newLimit: number) => void
  context?: 'user' | 'organization'
  organizationId?: string
}

export interface UsageLimitRef {
  startEdit: () => void
}

export const UsageLimit = forwardRef<UsageLimitRef, UsageLimitProps>(
  (
    {
      currentLimit,
      currentUsage,
      canEdit,
      minimumLimit,
      onLimitUpdated,
      context = 'user',
      organizationId,
    },
    ref
  ) => {
    const [inputValue, setInputValue] = useState(currentLimit.toString())
    const [hasError, setHasError] = useState(false)
    const [errorType, setErrorType] = useState<'general' | 'belowUsage' | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    // Use centralized usage limits hook
    const { updateLimit, isUpdating } = useUsageLimits({
      context,
      organizationId,
      autoRefresh: false, // Don't auto-refresh, we receive values via props
    })

    const handleStartEdit = () => {
      if (!canEdit) return
      setIsEditing(true)
      setInputValue(currentLimit.toString())
    }

    // Expose startEdit method through ref
    useImperativeHandle(
      ref,
      () => ({
        startEdit: handleStartEdit,
      }),
      [canEdit, currentLimit]
    )

    useEffect(() => {
      setInputValue(currentLimit.toString())
    }, [currentLimit])

    // Focus input when entering edit mode
    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, [isEditing])

    // Clear error after 2 seconds
    useEffect(() => {
      if (hasError) {
        const timer = setTimeout(() => {
          setHasError(false)
          setErrorType(null)
        }, 2000)
        return () => clearTimeout(timer)
      }
    }, [hasError])

    const handleSubmit = async () => {
      const newLimit = Number.parseInt(inputValue, 10)

      if (Number.isNaN(newLimit) || newLimit < minimumLimit) {
        setInputValue(currentLimit.toString())
        setIsEditing(false)
        return
      }

      // Check if new limit is below current usage
      if (newLimit < currentUsage) {
        setHasError(true)
        setErrorType('belowUsage')
        // Don't reset input value - let user see what they typed
        return
      }

      if (newLimit === currentLimit) {
        setIsEditing(false)
        return
      }

      // Use the centralized hook to update the limit
      const result = await updateLimit(newLimit)

      if (result.success) {
        setInputValue(newLimit.toString())
        onLimitUpdated?.(newLimit)
        setIsEditing(false)
        setErrorType(null)
        setHasError(false)
      } else {
        logger.error('Failed to update usage limit', { error: result.error })

        // Check if the error is about being below current usage
        if (result.error?.includes('below current usage')) {
          setErrorType('belowUsage')
        } else {
          setErrorType('general')
        }

        setHasError(true)
      }
    }

    const handleCancelEdit = () => {
      setIsEditing(false)
      setInputValue(currentLimit.toString())
      setHasError(false)
      setErrorType(null)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    }

    return (
      <div className='flex items-center'>
        {isEditing ? (
          <>
            <span className='text-muted-foreground text-xs tabular-nums'>$</span>
            <input
              ref={inputRef}
              type='number'
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={(e) => {
                // Don't submit if clicking on the button (it will handle submission)
                const relatedTarget = e.relatedTarget as HTMLElement
                if (relatedTarget?.closest('button')) {
                  return
                }
                handleSubmit()
              }}
              className={cn(
                'border-0 bg-transparent p-0 text-xs tabular-nums',
                'outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                hasError && 'text-red-500'
              )}
              min={minimumLimit}
              step='1'
              disabled={isUpdating}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
              style={{ width: `${Math.max(3, inputValue.length)}ch` }}
            />
          </>
        ) : (
          <span className='text-muted-foreground text-xs tabular-nums'>${currentLimit}</span>
        )}
        {canEdit && (
          <Button
            variant='ghost'
            size='icon'
            className={cn(
              'ml-1 h-4 w-4 p-0 transition-colors hover:bg-transparent',
              hasError
                ? 'text-red-500 hover:text-red-600'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={isEditing ? handleSubmit : handleStartEdit}
            disabled={isUpdating}
          >
            {isEditing ? (
              hasError ? (
                <X className='!h-3 !w-3' />
              ) : (
                <Check className='!h-3 !w-3' />
              )
            ) : (
              <Pencil className='!h-3 !w-3' />
            )}
            <span className='sr-only'>{isEditing ? 'Save limit' : 'Edit limit'}</span>
          </Button>
        )}
      </div>
    )
  }
)

UsageLimit.displayName = 'UsageLimit'
