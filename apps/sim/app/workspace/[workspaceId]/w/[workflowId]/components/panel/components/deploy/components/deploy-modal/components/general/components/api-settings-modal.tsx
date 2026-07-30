'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  ChipSwitch,
  Input,
  Label,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { getMeaningfulWorkflowDescription } from '@/lib/mcp/workflow-tool-schema'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import {
  useDeploymentInfo,
  usePublicationSettings,
  useUpdatePublicApi,
  useUpdatePublication,
} from '@/hooks/queries/deployments'
import { useUpdateWorkflow, useWorkflowMap } from '@/hooks/queries/workflows'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

type NormalizedField = InputFormatField & { name: string }

/** The org-publication half of the settings — everything that has no other home. */
interface PublishDraft {
  published: boolean
  visibility: 'org' | 'allowlist'
  exposeTrace: 'off' | 'traceId'
  exposeBlocks: boolean
}

const EMPTY_PUBLISH: PublishDraft = {
  published: false,
  visibility: 'org',
  exposeTrace: 'off',
  exposeBlocks: false,
}

interface ApiSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
}

/**
 * The single home for a workflow's API settings. Consolidates the contract prose
 * (description + per-parameter descriptions - the same `workflow.description` the MCP
 * schema and the API reference doc both read), the access mode (api key vs public),
 * and org publication (publish toggle, visibility, and the opt-in trace/block
 * exposures). One description, one modal, one Save.
 */
export function ApiSettingsModal({ open, onOpenChange, workflowId }: ApiSettingsModalProps) {
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

  const { data: publicationData } = usePublicationSettings(workflowId, { enabled: open })
  const updatePublicationMutation = useUpdatePublication()

  const [description, setDescription] = useState('')
  const [paramDescriptions, setParamDescriptions] = useState<Record<string, string>>({})
  const [accessMode, setAccessMode] = useState<'api_key' | 'public'>('api_key')
  const [publish, setPublish] = useState<PublishDraft>(EMPTY_PUBLISH)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const initialDescriptionRef = useRef('')
  const initialParamDescriptionsRef = useRef<Record<string, string>>({})
  const initialAccessModeRef = useRef<'api_key' | 'public'>('api_key')
  const initialPublishRef = useRef<PublishDraft>(EMPTY_PUBLISH)

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
  const publishInitializedRef = useRef(false)

  useEffect(() => {
    if (open) {
      const initialDescription =
        getMeaningfulWorkflowDescription(workflowMetadata?.description, workflowMetadata?.name) ??
        ''
      setDescription(initialDescription)
      initialDescriptionRef.current = initialDescription

      const descriptions: Record<string, string> = {}
      for (const field of inputFormat) {
        if (field.description) descriptions[field.name] = field.description
      }
      setParamDescriptions(descriptions)
      initialParamDescriptionsRef.current = { ...descriptions }

      setSaveError(null)
      accessModeInitializedRef.current = false
      publishInitializedRef.current = false
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

  useEffect(() => {
    if (open && publicationData && !publishInitializedRef.current) {
      const next: PublishDraft = {
        published: publicationData.published,
        visibility: publicationData.visibility,
        exposeTrace: publicationData.exposeTrace,
        exposeBlocks: publicationData.exposeBlocks,
      }
      setPublish(next)
      initialPublishRef.current = next
      publishInitializedRef.current = true
    }
  }, [open, publicationData])

  const hasChanges = useMemo(() => {
    if (description.trim() !== initialDescriptionRef.current.trim()) return true
    if (accessMode !== initialAccessModeRef.current) return true
    if (JSON.stringify(publish) !== JSON.stringify(initialPublishRef.current)) return true
    for (const field of inputFormat) {
      const currentValue = (paramDescriptions[field.name] || '').trim()
      const initialValue = (initialParamDescriptionsRef.current[field.name] || '').trim()
      if (currentValue !== initialValue) return true
    }
    return false
  }, [description, paramDescriptions, inputFormat, accessMode, publish])

  const handleParamDescriptionChange = (fieldName: string, value: string) => {
    setParamDescriptions((prev) => ({ ...prev, [fieldName]: value }))
  }

  const patchPublish = (partial: Partial<PublishDraft>) =>
    setPublish((prev) => ({ ...prev, ...partial }))

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
    setPublish(initialPublishRef.current)
    onOpenChange(false)
  }

  const handleSave = async () => {
    if (!workflowId) return
    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (activeWorkflowId !== workflowId) return

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
          metadata: { description: description.trim() },
        })
      }

      if (starterBlockId) {
        const updatedValue = inputFormat.map((field) => ({
          ...field,
          description: paramDescriptions[field.name]?.trim() || undefined,
        }))
        setValue(starterBlockId, 'inputFormat', updatedValue)
      }

      if (JSON.stringify(publish) !== JSON.stringify(initialPublishRef.current)) {
        await updatePublicationMutation.mutateAsync({
          workflowId,
          settings: {
            published: publish.published,
            visibility: publish.visibility,
            exposeTrace: publish.exposeTrace,
            exposeBlocks: publish.exposeBlocks,
          },
        })
      }

      onOpenChange(false)
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, 'Failed to save API settings'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={(openState) => !openState && handleCloseAttempt()}
        srTitle='API Settings'
      >
        <ChipModalHeader onClose={() => onOpenChange(false)}>API Settings</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='textarea'
            title='Description'
            value={description}
            onChange={setDescription}
            placeholder='Describe what this workflow API does...'
            minHeight={80}
            hint='Shown in the org API reference and used by the Sim agent.'
          />

          {!isPublicApiDisabled && (
            <ChipModalField type='custom' title='Access'>
              <ButtonGroup
                value={accessMode}
                onValueChange={(val) => setAccessMode(val as 'api_key' | 'public')}
              >
                <ButtonGroupItem value='api_key'>API Key</ButtonGroupItem>
                <ButtonGroupItem value='public'>Public</ButtonGroupItem>
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
                        <Label className='text-small'>Description</Label>
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

          <ChipModalField type='custom' title='Publish to org API reference'>
            <ChipSwitch
              value={publish.published ? 'on' : 'off'}
              onChange={(v) => patchPublish({ published: v === 'on' })}
              aria-label='Publish to org API reference'
              options={[
                { value: 'off', label: 'Unpublished' },
                { value: 'on', label: 'Published' },
              ]}
            />
            <p className='mt-1 text-[var(--text-secondary)] text-caption'>
              When published, any member of your organization can discover this endpoint and its
              contract - without access to this workspace's data.
            </p>
          </ChipModalField>

          {publish.published && (
            <>
              <ChipModalField type='custom' title='Visibility'>
                <ChipSwitch
                  value={publish.visibility}
                  onChange={(v) => patchPublish({ visibility: v as 'org' | 'allowlist' })}
                  aria-label='Visibility'
                  options={[
                    { value: 'org', label: 'Whole org' },
                    { value: 'allowlist', label: 'Allowlist' },
                  ]}
                />
              </ChipModalField>

              <ChipModalField type='custom' title='Expose execution trace'>
                <ChipSwitch
                  value={publish.exposeTrace}
                  onChange={(v) => patchPublish({ exposeTrace: v as 'off' | 'traceId' })}
                  aria-label='Expose execution trace'
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'traceId', label: 'Trace ID' },
                  ]}
                />
                <p className='mt-1 text-[var(--text-secondary)] text-caption'>
                  Lets a caller fetch the block-level trace of a run it triggered. Off by default.
                </p>
              </ChipModalField>

              <ChipModalField type='custom' title='Expose block structure'>
                <ChipSwitch
                  value={publish.exposeBlocks ? 'on' : 'off'}
                  onChange={(v) => patchPublish({ exposeBlocks: v === 'on' })}
                  aria-label='Expose block structure'
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'on', label: 'On' },
                  ]}
                />
                <p className='mt-1 text-[var(--text-secondary)] text-caption'>
                  Read-only, credential-redacted block introspection for self-diagnosis. Off by
                  default.
                </p>
              </ChipModalField>
            </>
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
        title='Unsaved Changes'
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
