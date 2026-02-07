'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { resolveSelectorForSubBlock } from '@/hooks/selectors/resolution'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface FolderSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, unknown>
}

export function FolderSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: FolderSelectorInputProps) {
  const [storeValue] = useSubBlockValue(blockId, subBlock.id)
  const [credentialFromStore] = useSubBlockValue(blockId, 'credential')
  const connectedCredential = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.credential)
    : credentialFromStore
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const { activeWorkflowId } = useWorkflowRegistry()
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')

  // Derive provider from serviceId using OAuth config (same pattern as credential-selector)
  const serviceId = subBlock.serviceId || ''
  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])
  const providerKey = serviceId.toLowerCase()

  const isCopyDestinationSelector =
    subBlock.canonicalParamId === 'copyDestinationId' ||
    subBlock.id === 'copyDestinationFolder' ||
    subBlock.id === 'manualCopyDestinationFolder'
  const { isForeignCredential } = useForeignCredential(
    effectiveProviderId,
    (connectedCredential as string) || ''
  )

  // Central dependsOn gating
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  // Get the current value from the store or prop value if in preview mode
  useEffect(() => {
    if (finalDisabled) return
    if (isPreview && previewValue !== undefined) {
      setSelectedFolderId(previewValue)
      return
    }
    const current = storeValue as string | undefined
    if (current) {
      setSelectedFolderId(current)
      return
    }
    const shouldDefaultInbox = providerKey === 'gmail' && !isCopyDestinationSelector
    if (shouldDefaultInbox) {
      setSelectedFolderId('INBOX')
      if (!isPreview) {
        collaborativeSetSubblockValue(blockId, subBlock.id, 'INBOX')
      }
    }
  }, [
    blockId,
    subBlock.id,
    storeValue,
    collaborativeSetSubblockValue,
    isPreview,
    previewValue,
    finalDisabled,
    providerKey,
    isCopyDestinationSelector,
  ])

  const credentialId = (connectedCredential as string) || ''
  const missingCredential = credentialId.length === 0
  const selectorResolution = useMemo(
    () =>
      resolveSelectorForSubBlock(subBlock, {
        credentialId: credentialId || undefined,
        workflowId: activeWorkflowId || undefined,
      }),
    [subBlock, credentialId, activeWorkflowId]
  )

  const handleChange = useCallback(
    (value: string) => {
      setSelectedFolderId(value)
      if (!isPreview) {
        collaborativeSetSubblockValue(blockId, subBlock.id, value)
      }
    },
    [blockId, subBlock.id, collaborativeSetSubblockValue, isPreview]
  )

  return (
    <SelectorCombobox
      blockId={blockId}
      subBlock={subBlock}
      selectorKey={selectorResolution?.key ?? 'gmail.labels'}
      selectorContext={
        selectorResolution?.context ?? { credentialId, workflowId: activeWorkflowId || '' }
      }
      disabled={
        finalDisabled || isForeignCredential || missingCredential || !selectorResolution?.key
      }
      isPreview={isPreview}
      previewValue={previewValue ?? null}
      placeholder={subBlock.placeholder || 'Select folder'}
      onOptionChange={handleChange}
    />
  )
}
