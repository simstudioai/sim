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
import { isDependency } from '@/blocks/utils'
import { resolveSelectorForSubBlock, type SelectorResolution } from '@/hooks/selectors/resolution'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface FileSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled: boolean
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, any>
}

export function FileSelectorInput({
  blockId,
  subBlock,
  disabled,
  isPreview = false,
  previewValue,
  previewContextValues,
}: FileSelectorInputProps) {
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
  const [domainValueFromStore] = useSubBlockValue(blockId, 'domain')
  const [projectIdValueFromStore] = useSubBlockValue(blockId, 'projectId')
  const [planIdValueFromStore] = useSubBlockValue(blockId, 'planId')
  const [teamIdValueFromStore] = useSubBlockValue(blockId, 'teamId')
  const [siteIdValueFromStore] = useSubBlockValue(blockId, 'siteId')
  const [collectionIdValueFromStore] = useSubBlockValue(blockId, 'collectionId')
  const [apiKeyValueFromStore] = useSubBlockValue(blockId, 'apiKey')
  const [boardIdValueFromStore] = useSubBlockValue(blockId, 'board_id')
  const [boardIdCamelFromStore] = useSubBlockValue(blockId, 'boardId')
  const [boardIdListFromStore] = useSubBlockValue(blockId, 'board_id_list')
  const [boardIdUpdateFromStore] = useSubBlockValue(blockId, 'board_id_update')
  const [groupIdValueFromStore] = useSubBlockValue(blockId, 'group_id')
  const [groupIdCamelFromStore] = useSubBlockValue(blockId, 'groupId')
  const [groupIdListFromStore] = useSubBlockValue(blockId, 'group_id_list')
  const [columnIdValueFromStore] = useSubBlockValue(blockId, 'column_id')
  const [columnIdCamelFromStore] = useSubBlockValue(blockId, 'columnId')
  const [itemIdValueFromStore] = useSubBlockValue(blockId, 'item_id')
  const [itemIdCamelFromStore] = useSubBlockValue(blockId, 'itemId')

  const connectedCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const domainValue = previewContextValues?.domain ?? domainValueFromStore
  const projectIdValue = previewContextValues?.projectId ?? projectIdValueFromStore
  const planIdValue = previewContextValues?.planId ?? planIdValueFromStore
  const teamIdValue = previewContextValues?.teamId ?? teamIdValueFromStore
  const siteIdValue = previewContextValues?.siteId ?? siteIdValueFromStore
  const collectionIdValue = previewContextValues?.collectionId ?? collectionIdValueFromStore
  const apiKeyValue = previewContextValues?.apiKey ?? apiKeyValueFromStore
  const boardIdValue =
    previewContextValues?.board_id ??
    previewContextValues?.boardId ??
    boardIdValueFromStore ??
    boardIdCamelFromStore ??
    boardIdListFromStore ??
    boardIdUpdateFromStore
  const groupIdValue =
    previewContextValues?.group_id ??
    previewContextValues?.groupId ??
    groupIdValueFromStore ??
    groupIdCamelFromStore ??
    groupIdListFromStore
  const columnIdValue =
    previewContextValues?.column_id ??
    previewContextValues?.columnId ??
    columnIdValueFromStore ??
    columnIdCamelFromStore
  const itemIdValue =
    previewContextValues?.item_id ??
    previewContextValues?.itemId ??
    itemIdValueFromStore ??
    itemIdCamelFromStore

  const normalizedCredentialId =
    typeof connectedCredential === 'string'
      ? connectedCredential
      : typeof connectedCredential === 'object' && connectedCredential !== null
        ? ((connectedCredential as Record<string, any>).id ?? '')
        : ''

  // Derive provider from serviceId using OAuth config (same pattern as credential-selector)
  const serviceId = subBlock.serviceId || ''
  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])

  const { isForeignCredential } = useForeignCredential(effectiveProviderId, normalizedCredentialId)

  const selectorResolution = useMemo<SelectorResolution | null>(() => {
    return resolveSelectorForSubBlock(subBlock, {
      workflowId: workflowIdFromUrl,
      credentialId: normalizedCredentialId,
      domain: (domainValue as string) || undefined,
      projectId: (projectIdValue as string) || undefined,
      planId: (planIdValue as string) || undefined,
      teamId: (teamIdValue as string) || undefined,
      siteId: (siteIdValue as string) || undefined,
      collectionId: (collectionIdValue as string) || undefined,
      apiKey: (apiKeyValue as string) || undefined,
      boardId: (boardIdValue as string) || undefined,
      groupId: (groupIdValue as string) || undefined,
      columnId: (columnIdValue as string) || undefined,
      itemId: (itemIdValue as string) || undefined,
    })
  }, [
    subBlock,
    workflowIdFromUrl,
    normalizedCredentialId,
    domainValue,
    projectIdValue,
    planIdValue,
    teamIdValue,
    siteIdValue,
    collectionIdValue,
    apiKeyValue,
    boardIdValue,
    groupIdValue,
    columnIdValue,
    itemIdValue,
  ])

  const isMondaySelector = selectorResolution?.key?.startsWith('monday.')
  const missingCredential = !isMondaySelector && !normalizedCredentialId
  const missingApiKey = isMondaySelector && !selectorResolution?.context.apiKey
  const missingDomain =
    selectorResolution?.key &&
    (selectorResolution.key === 'confluence.pages' || selectorResolution.key === 'jira.issues') &&
    !selectorResolution.context.domain
  const missingProject =
    selectorResolution?.key === 'jira.issues' &&
    isDependency(subBlock.dependsOn, 'projectId') &&
    !selectorResolution.context.projectId
  const missingPlan =
    selectorResolution?.key === 'microsoft.planner' && !selectorResolution.context.planId
  const missingSite =
    selectorResolution?.key === 'webflow.collections' && !selectorResolution.context.siteId
  const missingCollection =
    selectorResolution?.key === 'webflow.items' && !selectorResolution.context.collectionId
  const missingBoard =
    isMondaySelector &&
    (selectorResolution?.key === 'monday.groups' ||
      selectorResolution?.key === 'monday.columns' ||
      selectorResolution?.key === 'monday.items') &&
    !selectorResolution?.context.boardId
  const missingColumn =
    isMondaySelector &&
    selectorResolution?.key === 'monday.status-options' &&
    !selectorResolution?.context.columnId
  const missingItem =
    isMondaySelector &&
    selectorResolution?.key === 'monday.subitems' &&
    !selectorResolution?.context.itemId

  const disabledReason =
    finalDisabled ||
    isForeignCredential ||
    missingCredential ||
    missingApiKey ||
    missingDomain ||
    missingProject ||
    missingPlan ||
    missingSite ||
    missingCollection ||
    missingBoard ||
    missingColumn ||
    missingItem ||
    !selectorResolution?.key

  if (!selectorResolution?.key) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full rounded border p-4 text-center text-muted-foreground text-sm'>
            File selector not supported for service: {serviceId || 'unknown'}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>This file selector is not implemented for {serviceId || 'unknown'}</p>
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
      placeholder={subBlock.placeholder || 'Select resource'}
      allowSearch={selectorResolution.allowSearch}
      onOptionChange={(value) => {
        if (!isPreview) {
          collaborativeSetSubblockValue(blockId, subBlock.id, value)
        }
      }}
    />
  )
}
