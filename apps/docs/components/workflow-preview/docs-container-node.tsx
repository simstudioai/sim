'use client'

import { memo, useContext } from 'react'
import { cn } from '@sim/emcn'
import { type SubflowNodeData, SubflowNodeView } from '@sim/workflow-renderer'
import type { Node, NodeProps } from '@xyflow/react'
import { PreviewSelectionContext } from '@/components/workflow-preview/preview-selection-context'
import { DIMMED_PREVIEW_CLASS } from '@/components/workflow-preview/workflow-data'

export interface DocsContainerData extends Record<string, unknown> {
  name: string
  blockType: string
  size?: { width: number; height: number }
  parentId?: string
  isHighlighted?: boolean
  isDimmed?: boolean
}

export type DocsContainerNodeType = Node<DocsContainerData, 'previewContainer'>

/**
 * Docs adapter for loop/parallel container blocks: maps the static preview data
 * to {@link SubflowNodeView}'s read-only `isPreview` shape. Carries no stores
 * or queries — it only reshapes data into View props.
 */
export const DocsContainerNode = memo(function DocsContainerNode({
  id,
  data,
}: NodeProps<DocsContainerNodeType>) {
  const selectBlock = useContext(PreviewSelectionContext)
  const subflowData: SubflowNodeData = {
    kind: data.blockType === 'parallel' ? 'parallel' : 'loop',
    name: data.name,
    width: data.size?.width,
    height: data.size?.height,
    parentId: data.parentId,
    isPreview: true,
    isPreviewSelected: data.isHighlighted,
  }

  return (
    <div className={cn('h-full w-full', data.isDimmed && DIMMED_PREVIEW_CLASS)}>
      <SubflowNodeView
        id={id}
        data={subflowData}
        isEnabled
        isLocked={false}
        isFocused={false}
        nestingLevel={0}
        canEditWorkflow={false}
        onSelect={() => selectBlock?.(id)}
      />
    </div>
  )
})
