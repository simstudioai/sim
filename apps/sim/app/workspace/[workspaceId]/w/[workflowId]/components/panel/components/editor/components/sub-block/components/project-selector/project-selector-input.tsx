'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { resolveSelectorForSubBlock } from '@/hooks/selectors/resolution'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface ProjectSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onProjectSelect?: (projectId: string) => void
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, any>
}

export function ProjectSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onProjectSelect,
  isPreview = false,
  previewValue,
  previewContextValues,
}: ProjectSelectorInputProps) {
  const params = useParams()
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId) as string | null
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [storeValue] = useSubBlockValue(blockId, subBlock.id)
  const [jiraDomainFromStore] = useSubBlockValue(blockId, 'domain')

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

  const connectedCredential = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.credential)
    : blockValues.credential
  const jiraDomain = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.domain)
    : jiraDomainFromStore

  const linearTeamId = useMemo(
    () =>
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.teamId)
        : resolveDependencyValue('teamId', blockValues, canonicalIndex, canonicalModeOverrides),
    [previewContextValues, blockValues, canonicalIndex, canonicalModeOverrides]
  )

  const serviceId = subBlock.serviceId || ''
  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])

  const { isForeignCredential } = useForeignCredential(
    effectiveProviderId,
    (connectedCredential as string) || ''
  )
  const workflowIdFromUrl = (params?.workflowId as string) || activeWorkflowId || ''
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  const domain = (jiraDomain as string) || ''

  useEffect(() => {
    if (isPreview && previewValue !== undefined) {
      setSelectedProjectId(previewValue)
    } else if (typeof storeValue === 'string') {
      setSelectedProjectId(storeValue)
    } else {
      setSelectedProjectId('')
    }
  }, [isPreview, previewValue, storeValue])

  const selectorResolution = useMemo(() => {
    return resolveSelectorForSubBlock(subBlock, {
      workflowId: workflowIdFromUrl || undefined,
      credentialId: (connectedCredential as string) || undefined,
      domain,
      teamId: (linearTeamId as string) || undefined,
    })
  }, [subBlock, workflowIdFromUrl, connectedCredential, domain, linearTeamId])

  const missingCredential = !selectorResolution?.context.credentialId

  const handleChange = (value: string) => {
    setSelectedProjectId(value)
    onProjectSelect?.(value)
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className='w-full'>
          {selectorResolution?.key ? (
            <SelectorCombobox
              blockId={blockId}
              subBlock={subBlock}
              selectorKey={selectorResolution.key}
              selectorContext={selectorResolution.context}
              disabled={finalDisabled || isForeignCredential || missingCredential}
              isPreview={isPreview}
              previewValue={previewValue ?? null}
              placeholder={subBlock.placeholder || 'Select project'}
              onOptionChange={handleChange}
            />
          ) : (
            <div className='w-full rounded border p-4 text-center text-muted-foreground text-sm'>
              Project selector not supported for service: {serviceId}
            </div>
          )}
        </div>
      </Tooltip.Trigger>
      {missingCredential && (
        <Tooltip.Content side='top'>
          <p>Please select an account first</p>
        </Tooltip.Content>
      )}
    </Tooltip.Root>
  )
}
