'use client'

import { useMemo, useRef, useState } from 'react'
import { FieldFrame, TextAreaField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { ParameterDescriptions } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/deploy/parameter-descriptions/parameter-descriptions'
import {
  EMPTY_SUBBLOCK_VALUES,
  getMeaningfulWorkflowDescription,
  type InputFormatField,
  normalizeInputFormatValue,
  useDeploymentInfo,
  useUpdatePublicApi,
} from '@/platform/lib/data/workflow-deploy'
import {
  isInputDefinitionTrigger,
  usePermissionConfig,
  useSubBlockStore,
  useUpdateWorkflow,
  useWorkflowMap,
  useWorkflowRegistry,
  useWorkflowStore,
} from '@/platform/lib/data/workflows'

type NormalizedField = InputFormatField & { name: string }
type AccessMode = 'api_key' | 'public'

interface ApiInfoModalProps {
  workspaceId: string
  workflowId: string
  onClose: () => void
}

/**
 * The API's description, access (an API key, or public where policy allows) and the Start block's
 * parameter descriptions, which callers and MCP clients read. Leaving with changes asks first.
 */
export function ApiInfoModal({ workspaceId, workflowId, onClose }: ApiInfoModalProps) {
  const blocks = useWorkflowStore((state) => state.blocks)
  const setValue = useSubBlockStore((state) => state.setValue)
  const subBlockValues = useSubBlockStore(
    (state) => state.workflowValues[workflowId] ?? EMPTY_SUBBLOCK_VALUES
  )
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const workflow = workflows[workflowId]
  const updateWorkflow = useUpdateWorkflow()
  const { data: deployment } = useDeploymentInfo(workflowId)
  const updatePublicApi = useUpdatePublicApi()
  const { isPublicApiDisabled } = usePermissionConfig()
  const saved = useRef(false)

  const starterBlockId = useMemo(() => {
    for (const [blockId, block] of Object.entries(blocks))
      if (block?.type && isInputDefinitionTrigger(block.type)) return blockId
    return null
  }, [blocks])

  const inputFormat = useMemo((): NormalizedField[] => {
    if (!starterBlockId) return []
    const fromStore = normalizeInputFormatValue(
      subBlockValues[starterBlockId]?.inputFormat
    ) as NormalizedField[]
    if (fromStore.length > 0) return fromStore
    return normalizeInputFormatValue(
      blocks[starterBlockId]?.subBlocks?.inputFormat?.value
    ) as NormalizedField[]
  }, [starterBlockId, subBlockValues, blocks])

  const [initial] = useState(() => {
    const descriptions: Record<string, string> = {}
    for (const field of inputFormat)
      if (field.description) descriptions[field.name] = field.description
    return {
      description: getMeaningfulWorkflowDescription(workflow?.description, workflow?.name) ?? '',
      descriptions,
    }
  })
  const [description, setDescription] = useState(initial.description)
  const [paramDescriptions, setParamDescriptions] = useState(initial.descriptions)
  const [initialAccess, setInitialAccess] = useState<AccessMode | null>(null)
  const [accessMode, setAccessMode] = useState<AccessMode>('api_key')
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  // The saved access arrives with the deployment read; it seeds the choice once.
  if (deployment && initialAccess === null) {
    const access = deployment.isPublicApi ? 'public' : 'api_key'
    setInitialAccess(access)
    setAccessMode(access)
  }

  const parametersChanged = inputFormat.some(
    (field) =>
      (paramDescriptions[field.name] || '').trim() !==
      (initial.descriptions[field.name] || '').trim()
  )
  const hasChanges =
    description.trim() !== initial.description.trim() ||
    (initialAccess !== null && accessMode !== initialAccess) ||
    parametersChanged

  const save = async () => {
    if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) return false
    if (initialAccess !== null && accessMode !== initialAccess)
      await updatePublicApi.mutateAsync({ workflowId, isPublicApi: accessMode === 'public' })
    if (description.trim() !== (workflow?.description || ''))
      await updateWorkflow.mutateAsync({
        workspaceId,
        workflowId,
        metadata: { description: description.trim() },
      })
    // Rewriting an unchanged input format would read as a draft change and prompt a redeploy.
    if (starterBlockId && parametersChanged)
      setValue(
        starterBlockId,
        'inputFormat',
        inputFormat.map((field) => ({
          ...field,
          description: paramDescriptions[field.name]?.trim() || undefined,
        }))
      )
    saved.current = true
  }

  return (
    <>
      <Modal
        open
        onOpenChange={(next) => {
          if (next) return
          if (saved.current || !hasChanges) onClose()
          else setConfirmingDiscard(true)
        }}
        title='Edit API info'
        confirmLabel='Save'
        confirmDisabled={!hasChanges}
        submitOnEnter={false}
        onConfirm={save}
      >
        <TextAreaField
          label='Description'
          placeholder='Describe what this workflow API does'
          value={description}
          onChange={setDescription}
        />
        {!isPublicApiDisabled && (
          <FieldFrame
            label='Access'
            hint={
              accessMode === 'public'
                ? 'Anyone can call this API without authentication. You will be billed for all usage.'
                : 'Requires a valid API key to call this endpoint.'
            }
          >
            <SegmentedControl
              label='API access'
              options={[
                { value: 'api_key', label: 'API key' },
                { value: 'public', label: 'Public' },
              ]}
              value={accessMode}
              onSelect={setAccessMode}
            />
          </FieldFrame>
        )}
        <ParameterDescriptions
          fields={inputFormat}
          value={(name) => paramDescriptions[name] || ''}
          placeholder={(name) => `Enter description for ${name}`}
          onChange={(name, value) =>
            setParamDescriptions((current) => ({ ...current, [name]: value }))
          }
        />
      </Modal>
      <ConfirmDialog
        target={confirmingDiscard}
        onClose={() => setConfirmingDiscard(false)}
        title='Discard changes?'
        description='You have unsaved changes to this API.'
        confirmLabel='Discard changes'
        pendingLabel='Discarding…'
        onConfirm={() => {
          setConfirmingDiscard(false)
          onClose()
        }}
      />
    </>
  )
}
