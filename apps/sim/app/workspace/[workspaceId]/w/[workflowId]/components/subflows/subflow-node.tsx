import { memo, useMemo } from 'react'
import { type SubflowNodeData, SubflowNodeView } from '@sim/workflow-renderer'
import { type NodeProps, useReactFlow } from 'reactflow'
import { hasDiffStatus } from '@/lib/workflows/diff/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useLastRunPath } from '@/stores/execution'
import { usePanelEditorStore } from '@/stores/panel'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Editor container for {@link SubflowNodeView}.
 *
 * Resolves the subflow's enabled/locked/focus/diff/run state from the editor
 * stores, computes its nesting depth from the ReactFlow node tree, and renders
 * the pure view shared with the docs preview — injecting the editor-only
 * {@link ActionBar} through the view's `actionBar` slot.
 */
export const SubflowNodeComponent = memo(({ data, id, selected }: NodeProps<SubflowNodeData>) => {
  const { getNodes } = useReactFlow()
  const userPermissions = useUserPermissionsContext()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked

  const currentWorkflow = useCurrentWorkflow()
  const currentBlock = currentWorkflow.getBlockById(id)
  const diffStatus =
    currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
      ? currentBlock.is_diff
      : undefined

  const isEnabled = currentBlock?.enabled ?? true
  const isLocked = currentBlock?.locked ?? false
  const isPreview = data?.isPreview || false
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const isFocused = currentBlockId === id

  const lastRunPath = useLastRunPath()
  const executionStatus = data.executionStatus
  const isEvalErrorHighlighted = useTerminalStore(
    (state) =>
      !isPreview &&
      state.evalErrorHighlight?.workflowId === activeWorkflowId &&
      state.evalErrorHighlight.blockIds.includes(id)
  )
  const runPathStatus: 'success' | 'error' | undefined =
    executionStatus === 'success' || executionStatus === 'error'
      ? executionStatus
      : isPreview
        ? undefined
        : lastRunPath.get(id)

  /**
   * Nesting depth, walking the parent chain so the view can apply nested
   * container styling.
   */
  const nestingLevel = useMemo(() => {
    let level = 0
    let currentParentId = data?.parentId

    while (currentParentId) {
      level++
      const parentNode = getNodes().find((n) => n.id === currentParentId)
      if (!parentNode) break
      currentParentId = parentNode.data?.parentId
    }

    return level
  }, [data?.parentId, getNodes])

  return (
    <SubflowNodeView
      id={id}
      data={data}
      selected={selected}
      isEnabled={isEnabled}
      isLocked={isLocked}
      isFocused={isFocused}
      runPathStatus={runPathStatus}
      isEvalErrorHighlighted={isEvalErrorHighlighted}
      diffStatus={diffStatus}
      nestingLevel={nestingLevel}
      canEditWorkflow={canEditWorkflow}
      onSelect={() => setCurrentBlockId(id)}
      actionBar={<ActionBar blockId={id} blockType={data.kind} disabled={!canEditWorkflow} />}
    />
  )
})

SubflowNodeComponent.displayName = 'SubflowNodeComponent'
