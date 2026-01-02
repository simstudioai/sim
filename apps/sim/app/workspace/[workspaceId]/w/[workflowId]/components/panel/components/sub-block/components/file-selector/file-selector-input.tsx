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
  console.log('[FileSelectorInput RENDER]', { subBlockId: subBlock.id, serviceId: subBlock.serviceId })

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

  const normalizedCredentialId =
    typeof connectedCredential === 'string'
      ? connectedCredential
      : typeof connectedCredential === 'object' && connectedCredential !== null
        ? ((connectedCredential as Record<string, any>).id ?? '')
        : ''

  // Derive provider from serviceId using OAuth config
  const serviceId = subBlock.serviceId || ''
  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])

  const { isForeignCredential } = useForeignCredential(effectiveProviderId, normalizedCredentialId)

  const selectorResolution = useMemo<SelectorResolution | null>(() => {
    return resolveSelectorForSubBlock(subBlock, {
      credentialId: normalizedCredentialId,
      workflowId: workflowIdFromUrl,
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
    })
  }, [
    subBlock,
    normalizedCredentialId,
    workflowIdFromUrl,
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
    boardIdValueFromStore,
    boardIdCamelFromStore,
    boardIdListFromStore,
    boardIdUpdateFromStore,
    groupIdValueFromStore,
    groupIdCamelFromStore,
    groupIdListFromStore,
    columnIdValueFromStore,
    columnIdCamelFromStore,
  ])

  const isMondaySelector = selectorResolution?.key?.startsWith('monday.')
  const missingCredential = !isMondaySelector && !normalizedCredentialId
  const missingApiKey = isMondaySelector && !selectorResolution?.context.apiKey

  // Debug logging for Monday selectors
  if (isMondaySelector && typeof window !== 'undefined') {
    console.log('[Monday Selector Debug]', {
      subBlockId: subBlock.id,
      selectorKey: selectorResolution?.key,
      apiKeyFromStore: apiKeyValueFromStore,
      apiKeyValue: apiKeyValue,
      contextApiKey: selectorResolution?.context.apiKey,
      missingApiKey,
      finalDisabled,
      disabledReason: {
        finalDisabled,
        isForeignCredential,
        missingCredential,
        missingApiKey,
      },
    })
  }
  const missingDomain =
    selectorResolution?.key &&
    (selectorResolution.key === 'confluence.pages' || selectorResolution.key === 'jira.issues') &&
    !selectorResolution.context.domain
  const missingProject =
    selectorResolution?.key === 'jira.issues' &&
    isDependency(subBlock.dependsOn, 'projectId') &&
    !selectorResolution?.context.projectId
  const missingPlan =
    selectorResolution?.key === 'microsoft.planner' && !selectorResolution?.context.planId
  const missingSite =
    selectorResolution?.key === 'webflow.collections' && !selectorResolution?.context.siteId
  const missingCollection =
    selectorResolution?.key === 'webflow.items' && !selectorResolution?.context.collectionId
  const missingBoardId =
    (selectorResolution?.key === 'monday.columns' || selectorResolution?.key === 'monday.groups') &&
    !selectorResolution?.context.boardId

  const disabledReason =
    finalDisabled ||
    (!isMondaySelector && isForeignCredential) ||
    missingCredential ||
    missingApiKey ||
    missingDomain ||
    missingProject ||
    missingPlan ||
    missingSite ||
    missingCollection ||
    missingBoardId ||
    !selectorResolution?.key

  if (!selectorResolution?.key) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full rounded border p-4 text-center text-muted-foreground text-sm'>
            File selector not supported for service: {serviceId}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>This file selector is not implemented for {serviceId}</p>
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
          console.log('[FileSelectorInput] Setting value', {
            blockId,
            subBlockId: subBlock.id,
            value,
            valueType: typeof value,
          })
          collaborativeSetSubblockValue(blockId, subBlock.id, value)
        }
      }}
    />
  )
}
