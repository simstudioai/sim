'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import {
  Badge,
  ButtonGroup,
  ButtonGroupItem,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Input,
  Label,
} from '@/components/emcn'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import { useDeploymentInfo, useUpdatePublicApi } from '@/hooks/queries/deployments'
import { useUpdateWorkflow, useWorkflowMap } from '@/hooks/queries/workflows'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useTranslations } from 'next-intl'

type NormalizedField = InputFormatField & { name: string }

interface ApiInfoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
}

export function ApiInfoModal({ open, onOpenChange, workflowId }: ApiInfoModalProps) {
  const t = useTranslations('auto')
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const blocks = useWorkflowStore((state) => state.blocks)
  const setValue = useSubBlockStore((state) => state.setValue)
  const subBlockValues = useSubBlockStore(
    (state) => (workflowId ? state.workflowValues[workflowId] : undefined) ?? EMPTY_SUBBLOCK_VALUES
  )

  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const workflowMetadata = workflowId ? workflows[workflowId] : undefined
  const updateWorkflowMutation = useUpdateWorkflow()

  const { data: deploymentData } = useDeploymentInfo(workflowId, { enabled: open })
  const updatePublicApiMutation = useUpdatePublicApi()
  const { isPublicApiDisabled } = usePermissionConfig()

  const [description, setDescription] = useState('')
  const [paramDescriptions, setParamDescriptions] = useState<Record<string, string>>({})
  const [accessMode, setAccessMode] = useState<'api_key' | 'public'>('api_key')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const initialDescriptionRef = useRef('')
  const initialParamDescriptionsRef = useRef<Record<string, string>>({})
  const initialAccessModeRef = useRef<'api_key' | 'public'>('api_key')

  const starterBlockId = useMemo(() => {
    for (const [blockId, block] of Object.entries(blocks)) {
      if (!block || typeof block !== 'object') continue
      const blockType = (block as { type?: string }).type
      if (blockType && isInputDefinitionTrigger(blockType)) {
        return blockId
      }
    }
    return null
  }, [blocks])

  const inputFormat = useMemo((): NormalizedField[] => {
    if (!starterBlockId) return []

    const storeValue = subBlockValues[starterBlockId]?.inputFormat
    const normalized = normalizeInputFormatValue(storeValue) as NormalizedField[]
    if (normalized.length > 0) return normalized

    const startBlock = blocks[starterBlockId]
    const blockValue = startBlock?.subBlocks?.inputFormat?.value
    return normalizeInputFormatValue(blockValue) as NormalizedField[]
  }, [starterBlockId, subBlockValues, blocks])

  const accessModeInitializedRef = useRef(false)

  useEffect(() => {
    if (open) {
      const normalizedDesc = workflowMetadata?.description?.toLowerCase().trim()
      const isDefaultDescription =
        !workflowMetadata?.description ||
        workflowMetadata.description === workflowMetadata.name ||
        normalizedDesc === 'new workflow' ||
        normalizedDesc === 'your first workflow - start building here!'

      const initialDescription = isDefaultDescription ? '' : workflowMetadata?.description || ''
      setDescription(initialDescription)
      initialDescriptionRef.current = initialDescription

      const descriptions: Record<string, string> = {}
      for (const field of inputFormat) {
        if (field.description) {
          descriptions[field.name] = field.description
        }
      }
      setParamDescriptions(descriptions)
      initialParamDescriptionsRef.current = { ...descriptions }

      setSaveError(null)
      accessModeInitializedRef.current = false
    }
  }, [open, workflowMetadata, inputFormat])

  useEffect(() => {
    if (open && deploymentData && !accessModeInitializedRef.current) {
      const initialAccess = deploymentData.isPublicApi ? 'public' : 'api_key'
      setAccessMode(initialAccess)
      initialAccessModeRef.current = initialAccess
      accessModeInitializedRef.current = true
    }
  }, [open, deploymentData])

  const hasChanges = useMemo(() => {
    if (description.trim() !== initialDescriptionRef.current.trim()) return true
    if (accessMode !== initialAccessModeRef.current) return true

    for (const field of inputFormat) {
      const currentValue = (paramDescriptions[field.name] || '').trim()
      const initialValue = (initialParamDescriptionsRef.current[field.name] || '').trim()
      if (currentValue !== initialValue) return true
    }

    return false
  }, [description, paramDescriptions, inputFormat, accessMode])

  const handleParamDescriptionChange = (fieldName: string, value: string) => {
    setParamDescriptions((prev) => ({
      ...prev,
      [fieldName]: value,
    }))
  }

  const handleCloseAttempt = () => {
    if (hasChanges && !isSaving) {
      setShowUnsavedChangesAlert(true)
    } else {
      onOpenChange(false)
    }
  }

  const handleDiscardChanges = () => {
    setShowUnsavedChangesAlert(false)
    setDescription(initialDescriptionRef.current)
    setParamDescriptions({ ...initialParamDescriptionsRef.current })
    setAccessMode(initialAccessModeRef.current)
    onOpenChange(false)
  }

  const handleSave = async () => {
    if (!workflowId) return

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (activeWorkflowId !== workflowId) {
      return
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      if (accessMode !== initialAccessModeRef.current) {
        await updatePublicApiMutation.mutateAsync({
          workflowId,
          isPublicApi: accessMode === 'public',
        })
      }

      if (description.trim() !== (workflowMetadata?.description || '')) {
        await updateWorkflowMutation.mutateAsync({
          workspaceId,
          workflowId,
          metadata: { description: description.trim() || 'New workflow' },
        })
      }

      if (starterBlockId) {
        const updatedValue = inputFormat.map((field) => ({
          ...field,
          description: paramDescriptions[field.name]?.trim() || undefined,
        }))
        setValue(starterBlockId, 'inputFormat', updatedValue)
      }

      onOpenChange(false)
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to update access settings')
      setSaveError(message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={(openState) => !openState && handleCloseAttempt()}
        srTitle='Edit API Info'
      >
        <ChipModalHeader onClose={() => onOpenChange(false)}>{t('edit_api_info')}</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='textarea'
            title={t('description')}
            value={description}
            onChange={setDescription}
            placeholder={t('describe_what_this_workflow_api_does')}
            minHeight={80}
          />

          {!isPublicApiDisabled && (
            <ChipModalField type='custom' title={t('access')}>
              <ButtonGroup
                value={accessMode}
                onValueChange={(val) => setAccessMode(val as 'api_key' | 'public')}
              >
                <ButtonGroupItem value='api_key'>{t('api_key')}</ButtonGroupItem>
                <ButtonGroupItem value='public'>{t('public')}</ButtonGroupItem>
              </ButtonGroup>
              <p className='mt-1 text-[var(--text-secondary)] text-caption'>
                {accessMode === 'public'
                  ? 'Anyone can call this API without authentication. You will be billed for all usage.'
                  : 'Requires a valid API key to call this endpoint.'}
              </p>
            </ChipModalField>
          )}

          {inputFormat.length > 0 && (
            <ChipModalField type='custom' title={`Parameters (${inputFormat.length})`}>
              <div className='flex flex-col gap-2'>
                {inputFormat.map((field) => (
                  <div
                    key={field.name}
                    className='overflow-hidden rounded-sm border border-[var(--border-1)]'
                  >
                    <div className='flex items-center justify-between bg-[var(--surface-4)] px-2.5 py-[5px]'>
                      <div className='flex min-w-0 flex-1 items-center gap-2'>
                        <span className='block truncate font-medium text-[var(--text-tertiary)] text-sm'>
                          {field.name}
                        </span>
                        <Badge variant='type' size='sm'>
                          {field.type || 'string'}
                        </Badge>
                      </div>
                    </div>
                    <div className='rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
                      <div className='flex flex-col gap-1.5'>
                        <Label className='text-small'>{t('description')}</Label>
                        <Input
                          value={paramDescriptions[field.name] || ''}
                          onChange={(e) => handleParamDescriptionChange(field.name, e.target.value)}
                          placeholder={`Enter description for ${field.name}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ChipModalField>
          )}

          <ChipModalError>{saveError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleCloseAttempt}
          cancelDisabled={isSaving}
          primaryAction={{
            label: 'Save',
            onClick: handleSave,
            disabled: !hasChanges || isSaving,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={showUnsavedChangesAlert}
        onOpenChange={setShowUnsavedChangesAlert}
        srTitle='Unsaved Changes'
        title={t('unsaved_changes')}
        text='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{
          label: 'Discard Changes',
          onClick: handleDiscardChanges,
        }}
      />
    </>
  )
}
