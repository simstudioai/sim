'use client'

import { memo } from 'react'
import { type SubflowNodeData, SubflowNodeView } from '@sim/workflow-renderer'
import type { NodeProps } from 'reactflow'

interface DocsContainerData {
  name: string
  blockType: string
  size?: { width: number; height: number }
}

/**
 * Docs adapter for loop/parallel container blocks: maps the static preview data
 * to {@link SubflowNodeView}'s read-only `isPreview` shape. Carries no stores,
 * hooks, or queries — it only reshapes data into View props.
 */
export const DocsContainerNode = memo(function DocsContainerNode({
  id,
  data,
}: NodeProps<DocsContainerData>) {
  const subflowData: SubflowNodeData = {
    kind: data.blockType === 'parallel' ? 'parallel' : 'loop',
    name: data.name,
    width: data.size?.width,
    height: data.size?.height,
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
