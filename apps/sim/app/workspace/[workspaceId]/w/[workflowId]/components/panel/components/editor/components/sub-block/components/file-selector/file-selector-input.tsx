'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { isDependency } from '@/blocks/utils'
import { resolveSelectorForSubBlock, type SelectorResolution } from '@/hooks/selectors/resolution'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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

  const blockState = useWorkflowStore((state) => state.blocks[blockId])
  const blockConfig = blockState?.type ? getBlock(blockState.type) : null
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )
  const canonicalModeOverrides = blockState?.data?.canonicalModes

  const blockValues = useSubBlockStore((state) => {
    if (!activeWorkflowId) return {}
    const workflowValues = state.workflowValues[activeWorkflowId] || {}
    return (workflowValues as Record<string, Record<string, unknown>>)[blockId] || {}
  })

  const [domainValueFromStore] = useSubBlockValue(blockId, 'domain')

  const connectedCredential = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.credential)
    : blockValues.credential
  const domainValue = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.domain)
    : domainValueFromStore

  const teamIdValue = useMemo(
    () =>
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.teamId)
        : resolveDependencyValue('teamId', blockValues, canonicalIndex, canonicalModeOverrides),
    [previewContextValues, blockValues, canonicalIndex, canonicalModeOverrides]
  )

  const siteIdValue = useMemo(
    () =>
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.siteId)
        : resolveDependencyValue('siteId', blockValues, canonicalIndex, canonicalModeOverrides),
    [previewContextValues, blockValues, canonicalIndex, canonicalModeOverrides]
  )

  const collectionIdValue = useMemo(
    () =>
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.collectionId)
        : resolveDependencyValue(
            'collectionId',
            blockValues,
            canonicalIndex,
            canonicalModeOverrides
          ),
    [previewContextValues, blockValues, canonicalIndex, canonicalModeOverrides]
  )

  const projectIdValue = useMemo(
    () =>
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.projectId)
        : resolveDependencyValue('projectId', blockValues, canonicalIndex, canonicalModeOverrides),
    [previewContextValues, blockValues, canonicalIndex, canonicalModeOverrides]
  )

  const planIdValue = useMemo(
    () =>
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.planId)
        : resolveDependencyValue('planId', blockValues, canonicalIndex, canonicalModeOverrides),
    [previewContextValues, blockValues, canonicalIndex, canonicalModeOverrides]
  )

  const normalizedCredentialId =
    typeof connectedCredential === 'string'
      ? connectedCredential
      : typeof connectedCredential === 'object' && connectedCredential !== null
        ? ((connectedCredential as Record<string, any>).id ?? '')
        : ''

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
  ])

  const missingCredential = !normalizedCredentialId
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

  const disabledReason =
    finalDisabled ||
    isForeignCredential ||
    missingCredential ||
    missingDomain ||
    missingProject ||
    missingPlan ||
    missingSite ||
    missingCollection ||
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
