'use client'

import { useCallback } from 'react'
import { Badge, Tooltip } from '@sim/emcn'
import { MessageSquare } from 'lucide-react'
import type { WorkflowAnnotationApi } from '@/lib/api/contracts'
import { useWorkflowAnnotationsQuery } from '@/hooks/queries/workflow-annotations'
import { usePanelEditorStore } from '@/stores/panel/editor/store'

interface AnnotationBadgeProps {
  workflowId: string
  blockId: string
}

/**
 * Unresolved comment count badge in the block header. Clicking opens the
 * block's editor panel where the comment thread lives.
 */
export function AnnotationBadge({ workflowId, blockId }: AnnotationBadgeProps) {
  const selectUnresolvedCount = useCallback(
    (annotations: WorkflowAnnotationApi[]) =>
      annotations.filter((annotation) => annotation.blockId === blockId && !annotation.resolved)
        .length,
    [blockId]
  )
  const { data: unresolvedCount = 0 } = useWorkflowAnnotationsQuery(workflowId, {
    select: selectUnresolvedCount,
  })

  if (unresolvedCount === 0) return null

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Badge
          variant='gray-secondary'
          className='cursor-pointer'
          onClick={(e) => {
            e.stopPropagation()
            usePanelEditorStore.getState().setCurrentBlockId(blockId)
          }}
        >
          <span className='flex items-center gap-1'>
            <MessageSquare className='size-[10px]' />
            {unresolvedCount}
          </span>
        </Badge>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className='text-sm'>
          {unresolvedCount === 1 ? '1 open comment' : `${unresolvedCount} open comments`}
        </span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
