import { memo, useCallback, useMemo } from 'react'
import { BLOCK_DIMENSIONS, NoteBlockView } from '@sim/workflow-renderer'
import type { NodeProps } from 'reactflow'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { WorkflowBlockProps } from '../workflow-block/types'

interface NoteBlockNodeData extends WorkflowBlockProps {}

/** Extracts the string content from a raw subblock value (string or `{ value }`). */
function extractFieldValue(rawValue: unknown): string | undefined {
  if (typeof rawValue === 'string') return rawValue
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    const candidate = (rawValue as { value?: unknown }).value
    return typeof candidate === 'string' ? candidate : undefined
  }
  return undefined
}

/**
 * Editor container for {@link NoteBlockView}.
 *
 * Resolves the note's markdown content from its subblock value, the enabled/ring
 * visual state from {@link useBlockVisual}, and edit permission, then publishes
 * deterministic dimensions and renders the pure view shared with the docs
 * preview — injecting the editor-only {@link ActionBar} via the `actionBar` slot.
 */
export const NoteBlock = memo(function NoteBlock({
  id,
  data,
  selected,
}: NodeProps<NoteBlockNodeData>) {
  const { type, name } = data

  const { activeWorkflowId, isEnabled, handleClick, hasRing, ringStyles } = useBlockVisual({
    blockId: id,
    data,
    isSelected: selected,
  })
  const storedValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[id]
      },
      [activeWorkflowId, id]
    )
  )

  const content = useMemo(() => {
    if (data.isPreview && data.subBlockValues) {
      const extractedContent = extractFieldValue(data.subBlockValues.content)
      return typeof extractedContent === 'string' ? extractedContent : ''
    }
    const storedContent = extractFieldValue(storedValues?.content)
    return typeof storedContent === 'string' ? storedContent : ''
  }, [data.isPreview, data.subBlockValues, storedValues])

  const isEmpty = content.trim().length === 0

  const userPermissions = useUserPermissionsContext()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked

  /**
   * Calculate deterministic dimensions based on content structure. Uses fixed
   * width and computed height to avoid ResizeObserver jitter.
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      const contentHeight = isEmpty
        ? BLOCK_DIMENSIONS.NOTE_MIN_CONTENT_HEIGHT
        : BLOCK_DIMENSIONS.NOTE_BASE_CONTENT_HEIGHT
      const calculatedHeight =
        BLOCK_DIMENSIONS.HEADER_HEIGHT + BLOCK_DIMENSIONS.NOTE_CONTENT_PADDING + contentHeight

      return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: calculatedHeight }
    },
    dependencies: [isEmpty],
  })

  return (
    <NoteBlockView
      name={name}
      content={content}
      isEnabled={isEnabled}
      hasRing={hasRing}
      ringStyles={ringStyles}
      onSelect={handleClick}
      actionBar={<ActionBar blockId={id} blockType={type} disabled={!canEditWorkflow} />}
    />
  )
})
