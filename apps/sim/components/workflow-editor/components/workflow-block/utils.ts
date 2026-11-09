import type { Node, NodeProps } from '@xyflow/react'
import { WEBHOOK_PROVIDERS } from '@/components/workflow-editor/components/workflow-block/constants'
import type { WorkflowBlockProps } from '@/components/workflow-editor/components/workflow-block/types'

/**
 * Gets the display name for a webhook provider
 *
 * @param providerId - The provider identifier
 * @returns The human-readable provider name
 */
export function getProviderName(providerId: string): string {
  return WEBHOOK_PROVIDERS[providerId] || 'Webhook'
}

/**
 * Compares two WorkflowBlock props to determine if a re-render should be skipped.
 * Used as the comparison function for React.memo.
 *
 * Note: positionAbsoluteX and positionAbsoluteY are intentionally excluded since
 * WorkflowBlock does not use position props. React Flow handles positioning via CSS
 * transforms, and comparing them would cause unnecessary re-renders during dragging.
 *
 * @param prevProps - Previous node props
 * @param nextProps - Next node props
 * @returns True if render should be skipped (props are equal), false otherwise
 */
export function shouldSkipBlockRender(
  prevProps: NodeProps<Node<WorkflowBlockProps, 'workflowBlock'>>,
  nextProps: NodeProps<Node<WorkflowBlockProps, 'workflowBlock'>>
): boolean {
  return (
    prevProps.id === nextProps.id &&
    prevProps.data.type === nextProps.data.type &&
    prevProps.data.name === nextProps.data.name &&
    prevProps.data.isActive === nextProps.data.isActive &&
    prevProps.data.isPending === nextProps.data.isPending &&
    prevProps.data.isPreview === nextProps.data.isPreview &&
    prevProps.data.isPreviewSelected === nextProps.data.isPreviewSelected &&
    prevProps.data.config === nextProps.data.config &&
    prevProps.data.subBlockValues === nextProps.data.subBlockValues &&
    prevProps.data.blockState === nextProps.data.blockState &&
    prevProps.data.onSetErrorOutputEnabled === nextProps.data.onSetErrorOutputEnabled &&
    prevProps.data.onRemoveEdges === nextProps.data.onRemoveEdges &&
    prevProps.selected === nextProps.selected &&
    prevProps.dragging === nextProps.dragging
  )
}

/**
 * Creates a debounced version of a function
 *
 * @param func - The function to debounce
 * @param wait - The delay in milliseconds
 * @returns The debounced function
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}
