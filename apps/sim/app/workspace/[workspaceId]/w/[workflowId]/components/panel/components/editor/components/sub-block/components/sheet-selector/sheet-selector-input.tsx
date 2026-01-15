'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { resolveSelectorForSubBlock, type SelectorResolution } from '@/hooks/selectors/resolution'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface SheetSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled: boolean
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, any>
}

export function SheetSelectorInput({
  blockId,
  subBlock,
  disabled,
  isPreview = false,
  previewValue,
  previewContextValues,
}: SheetSelectorInputProps) {
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const { activeWorkflowId } = useWorkflowRegistry()
  const params = useParams()
  const workflowIdFromUrl = (params?.workflowId as string) || activeWorkflowId || ''

  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  const [connectedCredentialFromStore] = useSubBlockValue(blockId, 'credential')
  const [spreadsheetIdFromStore] = useSubBlockValue(blockId, 'spreadsheetId')
  const [manualSpreadsheetIdFromStore] = useSubBlockValue(blockId, 'manualSpreadsheetId')

  const connectedCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const spreadsheetId =
    previewContextValues?.spreadsheetId ??
    spreadsheetIdFromStore ??
    previewContextValues?.manualSpreadsheetId ??
    manualSpreadsheetIdFromStore

  const normalizedCredentialId =
    typeof connectedCredential === 'string'
      ? connectedCredential
      : typeof connectedCredential === 'object' && connectedCredential !== null
        ? ((connectedCredential as Record<string, any>).id ?? '')
        : ''

  const normalizedSpreadsheetId = typeof spreadsheetId === 'string' ? spreadsheetId.trim() : ''

  // Derive provider from serviceId using OAuth config
  const serviceId = subBlock.serviceId || ''
  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])

  const { isForeignCredential } = useForeignCredential(effectiveProviderId, normalizedCredentialId)

  const selectorResolution = useMemo<SelectorResolution | null>(() => {
    return resolveSelectorForSubBlock(subBlock, {
      workflowId: workflowIdFromUrl,
      credentialId: normalizedCredentialId,
      spreadsheetId: normalizedSpreadsheetId,
    })
  }, [subBlock, workflowIdFromUrl, normalizedCredentialId, normalizedSpreadsheetId])

  const missingCredential = !normalizedCredentialId
  const missingSpreadsheet = !normalizedSpreadsheetId

  const disabledReason =
    finalDisabled ||
    isForeignCredential ||
    missingCredential ||
    missingSpreadsheet ||
    !selectorResolution?.key

  if (!selectorResolution?.key) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full rounded border p-4 text-center text-muted-foreground text-sm'>
            Sheet selector not supported for service: {serviceId || 'unknown'}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>This sheet selector is not implemented for {serviceId || 'unknown'}</p>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return (
    <SelectorCombobox
      blockId={blockId}
      subBlock={subBlock}
      selectorKey={selectorResolution.key}
      selectorContext={selectorResolution.context}
      disabled={disabledReason}
      isPreview={isPreview}
      previewValue={previewValue ?? null}
      placeholder={subBlock.placeholder || 'Select sheet'}
      allowSearch={selectorResolution.allowSearch}
      onOptionChange={(value) => {
        if (!isPreview) {
          collaborativeSetSubblockValue(blockId, subBlock.id, value)
        }
      }}
    />
  )
}
