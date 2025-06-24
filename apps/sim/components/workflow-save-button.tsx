'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface WorkflowSaveButtonProps {
  isDirty: boolean
  isSaving: boolean
  error?: string
  onSave: () => void
  onClearError?: () => void
  className?: string
}

/**
 * Save button component for non-collaborative workflow editing
 * Shows different states: clean, dirty, saving, error
 */
export function WorkflowSaveButton({
  isDirty,
  isSaving,
  error,
  onSave,
  onClearError,
  className,
}: WorkflowSaveButtonProps) {
  const [showSaved, setShowSaved] = useState(false)

  // Show "Saved" state briefly after successful save
  useEffect(() => {
    if (!isDirty && !isSaving && !error && showSaved) {
      const timer = setTimeout(() => {
        setShowSaved(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [isDirty, isSaving, error, showSaved])

  // Set showSaved when transitioning from saving to clean
  useEffect(() => {
    if (!isDirty && !isSaving && !error) {
      setShowSaved(true)
    }
  }, [isDirty, isSaving, error])

  const handleClick = () => {
    if (error && onClearError) {
      onClearError()
    } else if (isDirty && !isSaving) {
      onSave()
    }
  }

  const getButtonContent = () => {
    if (isSaving) {
      return (
        <>
          <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          Saving...
        </>
      )
    }

    if (error) {
      return (
        <>
          <AlertCircle className='mr-2 h-4 w-4' />
          Retry
        </>
      )
    }

    if (showSaved && !isDirty) {
      return (
        <>
          <Check className='mr-2 h-4 w-4' />
          Saved
        </>
      )
    }

    return (
      <>
        <Save className='mr-2 h-4 w-4' />
        Save
      </>
    )
  }

  const getTooltipContent = () => {
    if (error) {
      return `Error: ${error}. Click to retry.`
    }
    if (isSaving) {
      return 'Saving workflow...'
    }
    if (showSaved && !isDirty) {
      return 'All changes saved'
    }
    if (isDirty) {
      return 'Save your changes'
    }
    return 'No changes to save'
  }

  const getButtonVariant = () => {
    if (error) return 'destructive'
    if (isDirty) return 'default'
    return 'outline'
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={handleClick}
          disabled={(!isDirty && !error) || isSaving}
          variant={getButtonVariant()}
          size='sm'
          className={cn(
            'transition-all duration-200',
            {
              'bg-green-600 hover:bg-green-700': showSaved && !isDirty && !error,
              'animate-pulse': isSaving,
            },
            className
          )}
        >
          {getButtonContent()}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{getTooltipContent()}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Keyboard shortcut component for save functionality
 */
export function WorkflowSaveShortcut({
  onSave,
  enabled = true,
}: {
  onSave: () => void
  enabled?: boolean
}) {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+S (Mac) or Ctrl+S (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        onSave()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onSave, enabled])

  return null
}
