import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components'
import { Trash } from '@/components/emcn/icons/trash'
import { cn } from '@/lib/core/utils/cn'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useTriggerConfigAggregation } from '@/hooks/use-trigger-config-aggregation'
import { useWebhookManagement } from '@/hooks/use-webhook-management'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'

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

  const effectiveTriggerId = useMemo(() => {
    if (triggerId && isTriggerValid(triggerId)) {
      return triggerId
    }
    const selectedTriggerId = useSubBlockStore.getState().getValue(blockId, 'selectedTriggerId')
    if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
      return selectedTriggerId
    }
    return triggerId
  }, [blockId, triggerId])

  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  const { webhookId, saveConfig, deleteConfig, isLoading } = useWebhookManagement({
    blockId,
    triggerId: effectiveTriggerId,
    isPreview,
    useWebhookUrl: true, // to store the webhook url in the store
  })

  const triggerConfig = useSubBlockStore((state) => state.getValue(blockId, 'triggerConfig'))
  const triggerCredentials = useSubBlockStore((state) =>
    state.getValue(blockId, 'triggerCredentials')
  )

  const triggerDef =
    effectiveTriggerId && isTriggerValid(effectiveTriggerId) ? getTrigger(effectiveTriggerId) : null

  const validateRequiredFields = useCallback(
    (
      configToCheck: Record<string, any> | null | undefined
    ): { valid: boolean; missingFields: string[] } => {
      if (!triggerDef) {
        return { valid: true, missingFields: [] }
      }

      const missingFields: string[] = []

      triggerDef.subBlocks
        .filter(
          (sb) => sb.required && sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id)
        )
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
      .filter((sb) => sb.required && sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id))
      .map((sb) => sb.id)
  }, [triggerDef])

  const subscribedSubBlockValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!triggerDef) return {}
        const values: Record<string, any> = {}
        requiredSubBlockIds.forEach((subBlockId) => {
          const value = state.getValue(blockId, subBlockId)
          if (value !== null && value !== undefined && value !== '') {
            values[subBlockId] = value
          }
        })
        return values
      },
      [blockId, triggerDef, requiredSubBlockIds]
    )
  )

  const previousValuesRef = useRef<Record<string, any>>({})
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (saveStatus !== 'error' || !triggerDef) {
      previousValuesRef.current = subscribedSubBlockValues
      return
    }

    const hasChanges = Object.keys(subscribedSubBlockValues).some(
      (key) =>
        previousValuesRef.current[key] !== (subscribedSubBlockValues as Record<string, any>)[key]
    )

    if (!hasChanges) {
      return
    }

    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current)
    }

    validationTimeoutRef.current = setTimeout(() => {
      const aggregatedConfig = useTriggerConfigAggregation(blockId, effectiveTriggerId)

      if (aggregatedConfig) {
        useSubBlockStore.getState().setValue(blockId, 'triggerConfig', aggregatedConfig)
      }

      const validation = validateRequiredFields(aggregatedConfig)

      if (validation.valid) {
        setErrorMessage(null)
        setSaveStatus('idle')
        logger.debug('Error cleared after validation passed', {
          blockId,
          triggerId: effectiveTriggerId,
        })
      } else {
        setErrorMessage(`Missing required fields: ${validation.missingFields.join(', ')}`)
        logger.debug('Error message updated', {
          blockId,
          triggerId: effectiveTriggerId,
          missingFields: validation.missingFields,
        })
      }

      previousValuesRef.current = subscribedSubBlockValues
    }, 300)

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [
    blockId,
    effectiveTriggerId,
    triggerDef,
    subscribedSubBlockValues,
    saveStatus,
    validateRequiredFields,
  ])

  const handleSave = async () => {
    if (isPreview || disabled) return

    setSaveStatus('saving')
    setErrorMessage(null)

    try {
      const aggregatedConfig = useTriggerConfigAggregation(blockId, effectiveTriggerId)

      if (aggregatedConfig) {
        useSubBlockStore.getState().setValue(blockId, 'triggerConfig', aggregatedConfig)
        logger.debug('Stored aggregated trigger config', {
          blockId,
          triggerId: effectiveTriggerId,
          aggregatedConfig,
        })
      }

      const validation = validateRequiredFields(aggregatedConfig)
      if (!validation.valid) {
        setErrorMessage(`Missing required fields: ${validation.missingFields.join(', ')}`)
        setSaveStatus('error')
        return
      }

      const success = await saveConfig()
      if (!success) {
        throw new Error('Save config returned false')
      }

      setSaveStatus('saved')
      setErrorMessage(null)

      const savedWebhookId = useSubBlockStore.getState().getValue(blockId, 'webhookId')
      const savedTriggerPath = useSubBlockStore.getState().getValue(blockId, 'triggerPath')
      const savedTriggerId = useSubBlockStore.getState().getValue(blockId, 'triggerId')
      const savedTriggerConfig = useSubBlockStore.getState().getValue(blockId, 'triggerConfig')

      collaborativeSetSubblockValue(blockId, 'webhookId', savedWebhookId)
      collaborativeSetSubblockValue(blockId, 'triggerPath', savedTriggerPath)
      collaborativeSetSubblockValue(blockId, 'triggerId', savedTriggerId)
      collaborativeSetSubblockValue(blockId, 'triggerConfig', savedTriggerConfig)

      setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)

      logger.info('Trigger configuration saved successfully', {
        blockId,
        triggerId: effectiveTriggerId,
        hasWebhookId: !!webhookId,
      })
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

        collaborativeSetSubblockValue(blockId, 'triggerPath', '')
        collaborativeSetSubblockValue(blockId, 'webhookId', null)
        collaborativeSetSubblockValue(blockId, 'triggerConfig', null)

        logger.info('Trigger configuration deleted successfully', {
          blockId,
          triggerId: effectiveTriggerId,
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
    <div id={`${blockId}-${subBlockId}`}>
      <div className='flex gap-2'>
        <Button
          variant='default'
          onClick={handleSave}
          disabled={disabled || isProcessing}
          className={cn(
            'flex-1',
            saveStatus === 'saved' && '!bg-green-600 !text-white hover:!bg-green-700',
            saveStatus === 'error' && '!bg-red-600 !text-white hover:!bg-red-700'
          )}
        >
          {saveStatus === 'saving' && 'Saving...'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Error'}
          {saveStatus === 'idle' && (webhookId ? 'Update Configuration' : 'Save Configuration')}
        </Button>

        {webhookId && (
          <Button variant='default' onClick={handleDeleteClick} disabled={disabled || isProcessing}>
            <Trash className='h-[14px] w-[14px]' />
          </Button>
        )}
      </div>

      {errorMessage && <p className='mt-2 text-[12px] text-[var(--text-error)]'>{errorMessage}</p>}

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Trigger</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete this trigger configuration? This will remove the
              webhook and stop all incoming triggers.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='active' onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
