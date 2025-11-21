'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
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
    subBlock.serviceId || subBlock.provider,
    normalizedCredentialId
  )

  const selectorResolution = useMemo<SelectorResolution | null>(() => {
    return resolveSelectorForSubBlock(subBlock, {
      workflowId: workflowIdFromUrl,
      credentialId: normalizedCredentialId,
      domain: (domainValue as string) || undefined,
      projectId: (projectIdValue as string) || undefined,
      planId: (planIdValue as string) || undefined,
      teamId: (teamIdValue as string) || undefined,
    })
  }, [
    subBlock,
    workflowIdFromUrl,
    normalizedCredentialId,
    domainValue,
    projectIdValue,
    planIdValue,
    teamIdValue,
  ])

  const missingCredential = !normalizedCredentialId
  const missingDomain =
    selectorResolution?.key &&
    (selectorResolution.key === 'confluence.pages' || selectorResolution.key === 'jira.issues') &&
    !selectorResolution.context.domain
  const missingProject =
    selectorResolution?.key === 'jira.issues' &&
    subBlock.dependsOn?.includes('projectId') &&
    !selectorResolution.context.projectId
  const missingPlan =
    selectorResolution?.key === 'microsoft.planner' && !selectorResolution.context.planId

  const disabledReason =
    finalDisabled ||
    isForeignCredential ||
    missingCredential ||
    missingDomain ||
    missingProject ||
    missingPlan ||
    !selectorResolution?.key

  if (!selectorResolution?.key) {
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
