import { memo, useMemo } from 'react'
import { type SubflowNodeData, SubflowNodeView } from '@sim/workflow-renderer'
import { type Node, type NodeProps, useReactFlow } from '@xyflow/react'
import { hasDiffStatus } from '@/lib/workflows/diff/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import {
  useCurrentWorkflow,
  useIsBlockInActiveExecutionHandoff,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useIsBlockActive, useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { usePanelEditorStore } from '@/stores/panel'

/**
 * Editor container for {@link SubflowNodeView}.
 *
 * Resolves the subflow's enabled/locked/focus/diff/run state from the editor
 * stores, computes its nesting depth from the ReactFlow node tree, and renders
 * the pure view shared with the docs preview — injecting the editor-only
 * {@link ActionBar} through the view's `actionBar` slot.
 */
type SubflowNode = Node<SubflowNodeData, 'subflowNode'>

export const SubflowNodeComponent = memo(({ data, id, selected }: NodeProps<SubflowNode>) => {
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
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const isFocused = currentBlockId === id

  /*
   * Three separate signals, deliberately. `isRunning` and
   * `isExecutionHighlighted` are per-container and drive this node's own loader
   * and border; `isWorkflowRunning` only swaps Run for Stop and disables
   * mutations. Driving the visuals off the workflow instead would light up
   * every node on the canvas for the whole run.
   */
  const isWorkflowRunning = useIsCurrentWorkflowExecuting()
  const isRunning = useIsBlockActive(id)
  const isExecutionHighlighted = useIsBlockInActiveExecutionHandoff(id)

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
      currentParentId =
        typeof parentNode.data?.parentId === 'string' ? parentNode.data.parentId : undefined
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
      isRunning={isRunning}
      isExecutionHighlighted={isExecutionHighlighted}
      diffStatus={diffStatus}
      nestingLevel={nestingLevel}
      canEditWorkflow={canEditWorkflow}
      onSelect={() => setCurrentBlockId(id)}
      actionBar={
        <ActionBar
          blockId={id}
          blockType={data.kind}
          disabled={!canEditWorkflow}
          variant='swell'
          isRunning={isRunning}
          isWorkflowRunning={isWorkflowRunning}
        />
      }
    />
  )
})

SubflowNodeComponent.displayName = 'SubflowNodeComponent'
