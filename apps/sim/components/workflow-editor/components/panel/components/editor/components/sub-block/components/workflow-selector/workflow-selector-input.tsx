'use client'

import { useMemo } from 'react'
import { SelectorCombobox } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useWorkflowScope } from '@/components/workspace-providers/workflow-scope-provider'
import { DELETED_WORKFLOW_LABEL } from '@/lib/workflows/labels'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorClientContext } from '@/hooks/queries/selectors'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface WorkflowSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
}

export function WorkflowSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: WorkflowSelectorInputProps) {
  const { workspaceId } = useWorkflowScope()
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)

  const context: SelectorClientContext = useMemo(
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
    />
  )
}
