'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isCollaborationEnabled } from '@/lib/environment'
import { cn } from '@/lib/utils'
import { useWorkflowOperationsSafe } from '@/contexts/workflow-operation-context'
import { useWorkflowSaveState } from '@/hooks/use-workflow-save-state'

/**
 * Save button component for the control bar
 * Only shows when collaboration is disabled
 */
export function ControlBarSaveButton() {
  const { operationManager, isCollaborative, isReady, localOperations } =
    useWorkflowOperationsSafe()
  const saveState = useWorkflowSaveState(localOperations || null)
  const [showSaved, setShowSaved] = useState(false)

  const collaborationEnabled = isCollaborationEnabled()

  // Show "Saved" state briefly after successful save
  useEffect(() => {
    if (!saveState.isDirty && !saveState.isSaving && !saveState.error && showSaved) {
      const timer = setTimeout(() => {
        setShowSaved(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [saveState.isDirty, saveState.isSaving, saveState.error, showSaved])

  // Set showSaved when transitioning from saving to clean
  useEffect(() => {
    if (!saveState.isDirty && !saveState.isSaving && !saveState.error) {
      setShowSaved(true)
    }
  }, [saveState.isDirty, saveState.isSaving, saveState.error])

  const handleClick = () => {
    if (saveState.error && saveState.clearError) {
      saveState.clearError()
    } else if (saveState.isDirty && !saveState.isSaving) {
      saveState.save()
    }
  }

  const getButtonContent = () => {
    if (saveState.isSaving) {
      return (
        <>
          <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          Saving...
        </>
      )
    }

    if (saveState.error) {
      return (
        <>
          <AlertCircle className='mr-2 h-4 w-4' />
          Retry
        </>
      )
    }

    if (showSaved && !saveState.isDirty) {
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
    if (saveState.error) {
      return `Error: ${saveState.error}. Click to retry.`
    }
    if (saveState.isSaving) {
      return 'Saving workflow...'
    }
    if (showSaved && !saveState.isDirty) {
      return 'All changes saved'
    }
    if (saveState.isDirty) {
      return 'Save your changes (Cmd+S)'
    }
    return 'No changes to save'
  }

  const getButtonVariant = () => {
    if (saveState.error) return 'destructive'
    if (saveState.isDirty) return 'default'
    return 'ghost'
  }

  // Don't render if collaboration is enabled or operations aren't ready
  if (
    collaborationEnabled ||
    isCollaborative ||
    !isReady ||
    !operationManager ||
    !localOperations
  ) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={handleClick}
          disabled={(!saveState.isDirty && !saveState.error) || saveState.isSaving}
          variant={getButtonVariant()}
          size='sm'
          className={cn('transition-all duration-200', {
            'bg-green-600 text-white hover:bg-green-700':
              showSaved && !saveState.isDirty && !saveState.error,
            'animate-pulse': saveState.isSaving,
          })}
        >
          {getButtonContent()}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{getTooltipContent()}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Keyboard shortcut handler for save functionality
 * Only active when collaboration is disabled
 */
export function SaveKeyboardShortcut() {
  const { localOperations } = useWorkflowOperationsSafe()
  const saveState = useWorkflowSaveState(localOperations || null)
  const collaborationEnabled = isCollaborationEnabled()

  useEffect(() => {
    // Skip if collaboration is enabled or no local operations
    if (collaborationEnabled || !localOperations) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+S (Mac) or Ctrl+S (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        if (saveState.isDirty && !saveState.isSaving) {
          saveState.save()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [collaborationEnabled, localOperations, saveState.save, saveState.isDirty, saveState.isSaving])

  return null
}
