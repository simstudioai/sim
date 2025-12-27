'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, X } from 'lucide-react'
import { Badge, Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useUpdateOrganizationUsageLimit } from '@/hooks/queries/organization'
import { useUpdateUsageLimit } from '@/hooks/queries/subscription'

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
    const [pendingLimit, setPendingLimit] = useState<number | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const updateUserLimitMutation = useUpdateUsageLimit()
    const updateOrgLimitMutation = useUpdateOrganizationUsageLimit()

    const isUpdating =
      context === 'organization'
        ? updateOrgLimitMutation.isPending
        : updateUserLimitMutation.isPending

    const handleStartEdit = () => {
      if (!canEdit) return
      setIsEditing(true)
      const displayLimit = pendingLimit !== null ? pendingLimit : currentLimit
      setInputValue(displayLimit.toString())
    }

    useImperativeHandle(
      ref,
      () => ({
        startEdit: handleStartEdit,
      }),
      [canEdit, currentLimit, pendingLimit]
    )

    useEffect(() => {
      if (pendingLimit !== null) {
        if (currentLimit === pendingLimit) {
          setPendingLimit(null)
          setInputValue(currentLimit.toString())
        }
      } else {
        setInputValue(currentLimit.toString())
      }
    }, [currentLimit, pendingLimit])

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, [isEditing])

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

      if (newLimit < currentUsage) {
        setHasError(true)
        setErrorType('belowUsage')
        return
      }

      if (newLimit === currentLimit) {
        setIsEditing(false)
        return
      }

      try {
        if (context === 'organization') {
          if (!organizationId) {
            logger.error('Organization ID is required for organization context')
            setErrorType('general')
            setHasError(true)
            return
          }

          await updateOrgLimitMutation.mutateAsync({ organizationId, limit: newLimit })
        } else {
          await updateUserLimitMutation.mutateAsync({ limit: newLimit })
        }

        setPendingLimit(newLimit)
        setInputValue(newLimit.toString())
        onLimitUpdated?.(newLimit)
        setIsEditing(false)
        setErrorType(null)
        setHasError(false)
      } catch (err) {
        logger.error('Failed to update usage limit', { error: err })

        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('below current usage')) {
          setErrorType('belowUsage')
        } else {
          setErrorType('general')
        }

        setPendingLimit(null)
        setInputValue(currentLimit.toString())
        setHasError(true)
      }
    }

    const handleCancelEdit = () => {
      setIsEditing(false)
      const displayLimit = pendingLimit !== null ? pendingLimit : currentLimit
      setInputValue(displayLimit.toString())
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

    const inputWidthCh = Math.max(3, inputValue.length + 1)

    return (
      <div className='flex items-center gap-[6px]'>
        {isEditing ? (
          <>
            <span className='font-medium text-[14px] text-[var(--text-primary)] tabular-nums'>
              $
            </span>
            <input
              ref={inputRef}
              type='number'
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={(e) => {
                const relatedTarget = e.relatedTarget as HTMLElement
                if (relatedTarget?.closest('button')) {
                  return
                }
                handleSubmit()
              }}
              className={cn(
                'border-0 bg-transparent p-0 font-medium text-[14px] text-[var(--text-primary)] tabular-nums',
                'outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                hasError && 'text-[var(--text-error)]'
              )}
              min={minimumLimit}
              step='1'
              disabled={isUpdating}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
              style={{ width: `${inputWidthCh}ch` }}
            />
            <Button
              variant='ghost'
              className='h-[12px] w-[12px] flex-shrink-0 p-0'
              onClick={handleSubmit}
              disabled={isUpdating}
              aria-label='Save limit'
            >
              {hasError ? (
                <X className='h-[12px] w-[12px] text-[var(--text-error)]' />
              ) : (
                <Check className='h-[12px] w-[12px]' />
              )}
            </Button>
          </>
        ) : (
          <>
            <span className='font-medium text-[14px] text-[var(--text-primary)] tabular-nums'>
              ${pendingLimit !== null ? pendingLimit : currentLimit}
            </span>
            {canEdit && (
              <Badge
                size='sm'
                variant='outline'
                className='cursor-pointer'
                onClick={handleStartEdit}
              >
                Edit Limit
              </Badge>
            )}
          </>
        )}
      </div>
    )
  }
)

UsageLimit.displayName = 'UsageLimit'
