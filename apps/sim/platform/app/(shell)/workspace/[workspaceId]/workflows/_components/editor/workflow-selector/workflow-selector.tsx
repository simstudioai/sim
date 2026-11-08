'use client'

import { useMemo } from 'react'
import { SelectorCombobox } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/selector-input/selector-combobox'
import {
  type SubBlockConfig,
  useWorkflowRegistry,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import {
  DELETED_WORKFLOW_LABEL,
  type SelectorClientContext,
} from '@/platform/lib/data/workflow-editor/selectors'

interface WorkflowSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

/**
 * Picks another workflow of the workspace for a Workflow block to call. The open workflow is left
 * out, and a workflow that has since been deleted reads as such.
 */
export function WorkflowSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: WorkflowSelectorInputProps) {
  const { workspaceId } = useWorkflowScope()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const context = useMemo<SelectorClientContext>(
    () => ({ workspaceId, excludeWorkflowId: activeWorkflowId ?? undefined }),
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
