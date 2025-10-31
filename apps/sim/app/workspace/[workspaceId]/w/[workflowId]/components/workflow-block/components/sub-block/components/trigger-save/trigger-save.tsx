import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, Save, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useTriggerConfigAggregation } from '@/hooks/use-trigger-config-aggregation'
import { useWebhookManagement } from '@/hooks/use-webhook-management'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger, isTriggerValid } from '@/triggers'

const logger = createLogger('TriggerSave')

interface TriggerSaveProps {
  blockId: string
  subBlockId: string
  triggerId?: string
  isPreview?: boolean
  disabled?: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function TriggerSave({
  blockId,
  subBlockId,
  triggerId,
  isPreview = false,
  disabled = false,
}: TriggerSaveProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting'>('idle')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { webhookId, saveConfig, deleteConfig, isLoading } = useWebhookManagement({
    blockId,
    triggerId,
    isPreview,
  })

  const triggerConfig = useSubBlockStore((state) => state.getValue(blockId, 'triggerConfig'))
  const triggerCredentials = useSubBlockStore((state) =>
    state.getValue(blockId, 'triggerCredentials')
  )

  const triggerDef = triggerId && isTriggerValid(triggerId) ? getTrigger(triggerId) : null

  const validateRequiredFields = useCallback(
    (
      configToCheck: Record<string, any> | null | undefined
    ): { valid: boolean; missingFields: string[] } => {
      if (!triggerDef) {
        return { valid: true, missingFields: [] }
      }

      const missingFields: string[] = []

      triggerDef.subBlocks
        .filter((sb) => sb.required && sb.mode === 'trigger')
        .forEach((subBlock) => {
          if (subBlock.id === 'triggerCredentials') {
            if (!triggerCredentials) {
              missingFields.push(subBlock.title || 'Credentials')
            }
          } else {
            const value = configToCheck?.[subBlock.id]
            if (value === undefined || value === null || value === '') {
              missingFields.push(subBlock.title || subBlock.id)
            }
          }
        })

      return {
        valid: missingFields.length === 0,
        missingFields,
      }
    },
    [triggerDef, triggerCredentials]
  )

  const requiredSubBlockIds = useMemo(() => {
    if (!triggerDef) return []
    return triggerDef.subBlocks
      .filter((sb) => sb.required && sb.mode === 'trigger')
      .map((sb) => sb.id)
  }, [triggerDef])

  const otherRequiredValues = useSubBlockStore((state) => {
    if (!triggerDef) return {}
    const values: Record<string, any> = {}
    requiredSubBlockIds
      .filter((id) => id !== 'triggerCredentials')
      .forEach((subBlockId) => {
        values[subBlockId] = state.getValue(blockId, subBlockId)
      })
    return values
  })

  const requiredSubBlockValues = useMemo(() => {
    return {
      triggerCredentials,
      ...otherRequiredValues,
    }
  }, [triggerCredentials, otherRequiredValues])

  const previousValuesRef = useRef<Record<string, any>>({})
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (saveStatus !== 'error' || !triggerDef) {
      previousValuesRef.current = requiredSubBlockValues
      return
    }

    const hasChanges = Object.keys(requiredSubBlockValues).some(
      (key) =>
        previousValuesRef.current[key] !== (requiredSubBlockValues as Record<string, any>)[key]
    )

    if (!hasChanges) {
      return
    }

    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current)
    }

    validationTimeoutRef.current = setTimeout(() => {
      const aggregatedConfig = useTriggerConfigAggregation(blockId, triggerId)

      if (aggregatedConfig) {
        useSubBlockStore.getState().setValue(blockId, 'triggerConfig', aggregatedConfig)
      }

      const configToValidate =
        aggregatedConfig ?? useSubBlockStore.getState().getValue(blockId, 'triggerConfig')
      const validation = validateRequiredFields(configToValidate)

      if (validation.valid) {
        setErrorMessage(null)
        setSaveStatus('idle')
        logger.debug('Error cleared after validation passed', { blockId, triggerId })
      } else {
        const newErrorMessage = `Missing required fields: ${validation.missingFields.join(', ')}`
        setErrorMessage((prev) => {
          if (prev !== newErrorMessage) {
            logger.debug('Error message updated', {
              blockId,
              triggerId,
              missingFields: validation.missingFields,
            })
            return newErrorMessage
          }
          return prev
        })
      }

      previousValuesRef.current = requiredSubBlockValues
    }, 300)

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [blockId, triggerId, triggerDef, requiredSubBlockValues, saveStatus, validateRequiredFields])

  const handleSave = async () => {
    if (isPreview || disabled) return

    setSaveStatus('saving')
    setErrorMessage(null)

    try {
      const aggregatedConfig = useTriggerConfigAggregation(blockId, triggerId)

      if (aggregatedConfig) {
        useSubBlockStore.getState().setValue(blockId, 'triggerConfig', aggregatedConfig)
        logger.debug('Stored aggregated trigger config', { blockId, triggerId, aggregatedConfig })
      }

      const configToValidate = aggregatedConfig ?? triggerConfig
      const validation = validateRequiredFields(configToValidate)
      if (!validation.valid) {
        setErrorMessage(`Missing required fields: ${validation.missingFields.join(', ')}`)
        setSaveStatus('error')
        return
      }

      const success = await saveConfig()

      if (success) {
        setSaveStatus('saved')
        setErrorMessage(null)

        setTimeout(() => {
          setSaveStatus('idle')
        }, 2000)

        logger.info('Trigger configuration saved successfully', {
          blockId,
          triggerId,
          hasWebhookId: !!webhookId,
        })
      } else {
        setSaveStatus('error')
        setErrorMessage('Failed to save trigger configuration. Please try again.')
        logger.error('Failed to save trigger configuration')
      }
    } catch (error: any) {
      setSaveStatus('error')
      setErrorMessage(error.message || 'An error occurred while saving.')
      logger.error('Error saving trigger configuration', { error })
    }
  }

  const handleDeleteClick = () => {
    if (isPreview || disabled || !webhookId) return
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async () => {
    setShowDeleteDialog(false)
    setDeleteStatus('deleting')
    setErrorMessage(null)

    try {
      const success = await deleteConfig()

      if (success) {
        setDeleteStatus('idle')
        setSaveStatus('idle')
        setErrorMessage(null)

        logger.info('Trigger configuration deleted successfully', {
          blockId,
          triggerId,
        })
      } else {
        setDeleteStatus('idle')
        setErrorMessage('Failed to delete trigger configuration.')
        logger.error('Failed to delete trigger configuration')
      }
    } catch (error: any) {
      setDeleteStatus('idle')
      setErrorMessage(error.message || 'An error occurred while deleting.')
      logger.error('Error deleting trigger configuration', { error })
    }
  }

  if (isPreview) {
    return null
  }

  const isProcessing = saveStatus === 'saving' || deleteStatus === 'deleting' || isLoading

  return (
    <div id={`${blockId}-${subBlockId}`} className='space-y-2'>
      <div className='flex gap-2'>
        <Button
          onClick={handleSave}
          disabled={disabled || isProcessing}
          className={cn(
            'h-9 flex-1 transition-all duration-200',
            saveStatus === 'saved' && 'bg-green-600 hover:bg-green-700',
            saveStatus === 'error' && 'bg-red-600 hover:bg-red-700'
          )}
        >
          {saveStatus === 'saving' && (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              Saving...
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check className='mr-2 h-4 w-4' />
              Saved
            </>
          )}
          {saveStatus === 'error' && (
            <>
              <AlertCircle className='mr-2 h-4 w-4' />
              Error
            </>
          )}
          {saveStatus === 'idle' && (
            <>
              <Save className='mr-2 h-4 w-4' />
              {webhookId ? 'Update Configuration' : 'Save Configuration'}
            </>
          )}
        </Button>

        {webhookId && (
          <Button
            onClick={handleDeleteClick}
            disabled={disabled || isProcessing}
            variant='outline'
            className='h-9 px-3 text-destructive hover:bg-destructive/10'
          >
            {deleteStatus === 'deleting' ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Trash2 className='h-4 w-4' />
            )}
          </Button>
        )}
      </div>

      {errorMessage && (
        <div className='flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-destructive text-sm'>
          <AlertCircle className='mt-0.5 h-4 w-4 flex-shrink-0' />
          <span>{errorMessage}</span>
        </div>
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Trigger Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this trigger configuration? This will remove the
              webhook and stop all incoming triggers. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
