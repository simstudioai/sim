'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
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

  const connectedCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const domainValue = previewContextValues?.domain ?? domainValueFromStore
  const projectIdValue = previewContextValues?.projectId ?? projectIdValueFromStore
  const planIdValue = previewContextValues?.planId ?? planIdValueFromStore
  const teamIdValue = previewContextValues?.teamId ?? teamIdValueFromStore

  const normalizedCredentialId =
    typeof connectedCredential === 'string'
      ? connectedCredential
      : typeof connectedCredential === 'object' && connectedCredential !== null
        ? ((connectedCredential as Record<string, any>).id ?? '')
        : ''

  const { isForeignCredential } = useForeignCredential(
    subBlock.provider || subBlock.serviceId || 'google-drive',
    normalizedCredentialId
  )

  const selectorResolution = useMemo(() => {
    return resolveSelector({
      provider: subBlock.provider || '',
      serviceId: subBlock.serviceId,
      mimeType: subBlock.mimeType,
      credentialId: normalizedCredentialId,
      workflowId: workflowIdFromUrl,
      domain: (domainValue as string) || '',
      projectId: (projectIdValue as string) || '',
      planId: (planIdValue as string) || '',
      teamId: (teamIdValue as string) || '',
    })
  }, [
    subBlock.provider,
    subBlock.serviceId,
    subBlock.mimeType,
    normalizedCredentialId,
    workflowIdFromUrl,
    domainValue,
    projectIdValue,
    planIdValue,
    teamIdValue,
  ])

  const missingCredential = !normalizedCredentialId
  const missingDomain =
    selectorResolution.key &&
    (selectorResolution.key === 'confluence.pages' || selectorResolution.key === 'jira.issues') &&
    !selectorResolution.context.domain
  const missingProject =
    selectorResolution.key === 'jira.issues' &&
    subBlock.dependsOn?.includes('projectId') &&
    !selectorResolution.context.projectId
  const missingPlan =
    selectorResolution.key === 'microsoft.planner' && !selectorResolution.context.planId

  const disabledReason =
    finalDisabled ||
    isForeignCredential ||
    missingCredential ||
    missingDomain ||
    missingProject ||
    missingPlan ||
    selectorResolution.key === null

  if (selectorResolution.key === null) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full rounded border border-dashed p-4 text-center text-muted-foreground text-sm'>
            File selector not supported for provider: {subBlock.provider || subBlock.serviceId}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>This file selector is not implemented for {subBlock.provider || subBlock.serviceId}</p>
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

interface SelectorParams {
  provider: string
  serviceId?: string
  mimeType?: string
  credentialId: string
  workflowId: string
  domain?: string
  projectId?: string
  planId?: string
  teamId?: string
}

function resolveSelector(params: SelectorParams): {
  key: SelectorKey | null
  context: SelectorContext
  allowSearch: boolean
} {
  const baseContext: SelectorContext = {
    credentialId: params.credentialId,
    workflowId: params.workflowId,
    domain: params.domain,
    projectId: params.projectId,
    planId: params.planId,
    teamId: params.teamId,
    mimeType: params.mimeType,
  }

  switch (params.provider) {
    case 'google-calendar':
      return { key: 'google.calendar', context: baseContext, allowSearch: false }
    case 'confluence':
      return { key: 'confluence.pages', context: baseContext, allowSearch: true }
    case 'jira':
      return { key: 'jira.issues', context: baseContext, allowSearch: true }
    case 'microsoft-teams':
      return { key: 'microsoft.teams', context: baseContext, allowSearch: true }
    case 'wealthbox':
      return { key: 'wealthbox.contacts', context: baseContext, allowSearch: true }
    case 'microsoft-planner':
      return { key: 'microsoft.planner', context: baseContext, allowSearch: true }
    case 'microsoft-excel':
      return { key: 'microsoft.excel', context: baseContext, allowSearch: true }
    case 'microsoft-word':
      return { key: 'microsoft.word', context: baseContext, allowSearch: true }
    case 'google-drive':
      return { key: 'google.drive', context: baseContext, allowSearch: true }
    default:
      break
  }

  if (params.serviceId === 'onedrive') {
    const key: SelectorKey = params.mimeType === 'file' ? 'onedrive.files' : 'onedrive.folders'
    return { key, context: baseContext, allowSearch: true }
  }

  if (params.serviceId === 'sharepoint') {
    return { key: 'sharepoint.sites', context: baseContext, allowSearch: true }
  }

  if (params.serviceId === 'google-drive') {
    return { key: 'google.drive', context: baseContext, allowSearch: true }
  }

  return { key: null, context: baseContext, allowSearch: true }
}
