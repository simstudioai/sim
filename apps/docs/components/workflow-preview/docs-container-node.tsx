'use client'

import { memo } from 'react'
import { type SubflowNodeData, SubflowNodeView } from '@sim/workflow-renderer'
import type { Node, NodeProps } from '@xyflow/react'

export interface DocsContainerData extends Record<string, unknown> {
  name: string
  blockType: string
  size?: { width: number; height: number }
  parentId?: string
}

export type DocsContainerNodeType = Node<DocsContainerData, 'previewContainer'>

/**
 * Docs adapter for loop/parallel container blocks: maps the static preview data
 * to {@link SubflowNodeView}'s read-only `isPreview` shape. Carries no stores,
 * hooks, or queries — it only reshapes data into View props.
 */
export const DocsContainerNode = memo(function DocsContainerNode({
  id,
  data,
}: NodeProps<DocsContainerNodeType>) {
  const subflowData: SubflowNodeData = {
    kind: data.blockType === 'parallel' ? 'parallel' : 'loop',
    name: data.name,
    width: data.size?.width,
    height: data.size?.height,
    parentId: data.parentId,
    isPreview: true,
  }

  return (
    <SubflowNodeView
      id={id}
      data={subflowData}
      isEnabled
      isLocked={false}
      isFocused={false}
      nestingLevel={0}
      canEditWorkflow={false}
      onSelect={() => {}}
    />
  )
})
