'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { DELETED_WORKFLOW_LABEL } from '@/app/workspace/[workspaceId]/logs/utils'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface WorkflowSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  activeSearchTarget?: ActiveSearchTarget | null
}

export function WorkflowSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  activeSearchTarget,
}: WorkflowSelectorInputProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)

  const context: SelectorContext = useMemo(
    () => ({
      workspaceId,
      excludeWorkflowId: activeWorkflowId ?? undefined,
    }),
    [activeWorkflowId, workspaceId]
  )

  return (
    <SelectorCombobox
      blockId={blockId}
      subBlock={subBlock}
      selectorKey='sim.workflows'
      selectorContext={context}
      disabled={disabled}
      isPreview={isPreview}
      previewValue={previewValue}
      placeholder={subBlock.placeholder || 'Select workflow...'}
      missingOptionLabel={DELETED_WORKFLOW_LABEL}
      activeSearchTarget={activeSearchTarget}
    />
  )
}
