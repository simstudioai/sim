'use client'

import { useEffect, useMemo, useState } from 'react'
import { Tooltip } from '@/components/emcn'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { resolveSelectorForSubBlock } from '@/hooks/selectors/resolution'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  // Use the proper hook to get the current value and setter
  const [storeValue] = useSubBlockValue(blockId, subBlock.id)
  const [connectedCredentialFromStore] = useSubBlockValue(blockId, 'credential')
  const [linearTeamIdFromStore] = useSubBlockValue(blockId, 'teamId')
  const [jiraDomainFromStore] = useSubBlockValue(blockId, 'domain')

  // Use previewContextValues if provided (for tools inside agent blocks), otherwise use store values
  const connectedCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const linearCredential = previewContextValues?.credential ?? connectedCredentialFromStore
  const linearTeamId = previewContextValues?.teamId ?? linearTeamIdFromStore
  const jiraDomain = previewContextValues?.domain ?? jiraDomainFromStore

  const { isForeignCredential } = useForeignCredential(
    subBlock.provider || subBlock.serviceId || 'jira',
    (connectedCredential as string) || ''
  )
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId) as string | null
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  // Get provider-specific values
  const provider = subBlock.provider || 'jira'
  const isLinear = provider === 'linear'

  // Jira/Discord upstream fields - use values from previewContextValues or store
  const jiraCredential = connectedCredential
  const domain = (jiraDomain as string) || ''

  // Verify Jira credential belongs to current user; if not, treat as absent

  // Get the current value from the store or prop value if in preview mode
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
      workflowId: activeWorkflowId || undefined,
      credentialId: (isLinear ? linearCredential : jiraCredential) as string | undefined,
      domain,
      teamId: (linearTeamId as string) || undefined,
    })
  }, [subBlock, activeWorkflowId, isLinear, linearCredential, jiraCredential, domain, linearTeamId])

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
            <div className='w-full rounded border border-dashed p-4 text-center text-muted-foreground text-sm'>
              Project selector not supported for provider: {subBlock.provider || 'unknown'}
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
