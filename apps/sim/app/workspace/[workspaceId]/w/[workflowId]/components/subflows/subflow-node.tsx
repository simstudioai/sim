import { memo, useMemo } from 'react'
import { type SubflowNodeData, SubflowNodeView } from '@sim/workflow-renderer'
import { type NodeProps, useReactFlow } from 'reactflow'
import { hasDiffStatus } from '@/lib/workflows/diff/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useLastRunPath } from '@/stores/execution'
import { usePanelEditorStore } from '@/stores/panel'

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

  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const isFocused = currentBlockId === id

  const lastRunPath = useLastRunPath()
  const executionStatus = data.executionStatus
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
    const nodesById = new Map(getNodes().map((n) => [n.id, n]))
    let level = 0
    let currentParentId = data?.parentId

    while (currentParentId) {
      level++
      const parentNode = nodesById.get(currentParentId)
      if (!parentNode) break
      currentParentId = parentNode.data?.parentId
    }

    return level
  }, [data?.parentId, getNodes])

  const actionBar = useMemo(
    () => <ActionBar blockId={id} blockType={data.kind} disabled={!canEditWorkflow} />,
    [id, data.kind, canEditWorkflow]
  )

  return (
    <SubflowNodeView
      id={id}
      data={data}
      selected={selected}
      isEnabled={isEnabled}
      isLocked={isLocked}
      isFocused={isFocused}
      runPathStatus={runPathStatus}
      diffStatus={diffStatus}
      nestingLevel={nestingLevel}
      canEditWorkflow={canEditWorkflow}
      onSelect={() => setCurrentBlockId(id)}
      actionBar={actionBar}
    />
  )
})

SubflowNodeComponent.displayName = 'SubflowNodeComponent'
