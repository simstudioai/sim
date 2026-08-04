import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BLOCK_DIMENSIONS,
  DEFAULT_NOTE_COLOR,
  estimateNoteBlockHeight,
  getNoteStringValue,
  isNoteColor,
  NoteBlockView,
  type NoteColor,
  type NoteContentEditorProps,
} from '@sim/workflow-renderer'
import { type NodeProps, useReactFlow } from 'reactflow'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { NoteMarkdownEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-markdown-editor'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { isBlockProtected } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { usePanelEditorStore } from '@/stores/panel'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface NoteBlockNodeData extends WorkflowBlockProps {}

const NOTE_EXPAND_FOCUS_DURATION_MS = 300

function renderNoteContentEditor(props: NoteContentEditorProps) {
  return <NoteMarkdownEditor {...props} />
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
  const focusFrameRef = useRef<number | null>(null)
  const { getNode, getViewport, setCenter } = useReactFlow()

  const { activeWorkflowId, isEnabled, hasRing, ringStyles } = useBlockVisual({
    blockId: id,
    data,
    isSelected: selected,
  })
  const { collaborativeSetSubblockValue, collaborativeUpdateBlockName } = useCollaborativeWorkflow()
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
      const extractedContent = getNoteStringValue(data.subBlockValues.content)
      return typeof extractedContent === 'string' ? extractedContent : ''
    }
    const storedContent = getNoteStringValue(storedValues?.content)
    return typeof storedContent === 'string' ? storedContent : ''
  }, [data.isPreview, data.subBlockValues, storedValues])

  const rawColor = data.isPreview
    ? getNoteStringValue(data.subBlockValues?.color)
    : getNoteStringValue(storedValues?.color)
  const noteColor = isNoteColor(rawColor) ? rawColor : DEFAULT_NOTE_COLOR

  const userPermissions = useUserPermissionsContext()
  const isWorkflowRunning = useIsCurrentWorkflowExecuting()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked
  const isProtected = useWorkflowStore(
    useCallback((state) => isBlockProtected(id, state.blocks), [id])
  )
  const clearCurrentBlock = usePanelEditorStore((state) => state.clearCurrentBlock)
  const canEditNote = canEditWorkflow && !data.isPreview && !isProtected
  const [blockHeight, setBlockHeight] = useState(() => estimateNoteBlockHeight(content))
  const [isExpanded, setIsExpanded] = useState(false)
  const isFocused = selected

  /* Collapsed during render rather than in an effect: losing edit rights while
     expanded would otherwise paint one frame of an expanded-but-uneditable
     note before the effect corrected it. Seeded with the live value so a note
     that mounts uneditable does not reset anything it has not opened. */
  const [prevCanEditNote, setPrevCanEditNote] = useState(canEditNote)
  if (prevCanEditNote !== canEditNote) {
    setPrevCanEditNote(canEditNote)
    if (!canEditNote) setIsExpanded(false)
  }

  useEffect(
    () => () => {
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
    },
    []
  )

  const handleNameChange = (nextName: string) => {
    if (!canEditNote) return false
    return collaborativeUpdateBlockName(id, nextName).success
  }

  const handleContentChange = (nextContent: string) => {
    if (!canEditNote) return
    collaborativeSetSubblockValue(id, 'content', nextContent)
  }

  const handleColorChange = useCallback(
    (color: NoteColor) => {
      if (!canEditNote) return
      collaborativeSetSubblockValue(id, 'color', color)
    },
    [canEditNote, collaborativeSetSubblockValue, id]
  )

  const handleNoteSelect = useCallback(() => {
    if (data.isPreview || data.isEmbedded) return
    clearCurrentBlock()
  }, [clearCurrentBlock, data.isEmbedded, data.isPreview])

  const handleExpandedChange = useCallback(
    (expanded: boolean) => {
      if (expanded && !canEditNote) return
      if (expanded) handleNoteSelect()
      setIsExpanded(expanded)

      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
      if (!expanded) return

      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = requestAnimationFrame(() => {
          focusFrameRef.current = null
          const node = getNode(id)
          const position = node?.positionAbsolute ?? node?.position
          if (!position) return
          void setCenter(
            position.x + BLOCK_DIMENSIONS.NOTE_WIDTH / 2,
            position.y + blockHeight / 2,
            {
              zoom: getViewport().zoom,
              duration: NOTE_EXPAND_FOCUS_DURATION_MS,
            }
          )
        })
      })
    },
    [blockHeight, canEditNote, getNode, getViewport, handleNoteSelect, id, setCenter]
  )

  /**
   * Calculate deterministic dimensions based on content structure. Uses fixed
   * width and computed height to avoid ResizeObserver jitter.
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      return {
        width: BLOCK_DIMENSIONS.NOTE_WIDTH,
        height: blockHeight,
      }
    },
    dependencies: [blockHeight],
  })

  return (
    <NoteBlockView
      name={name}
      content={content}
      noteColor={noteColor}
      isEnabled={isEnabled}
      isFocused={isFocused}
      isExpanded={isExpanded}
      canEdit={canEditNote}
      hasRing={hasRing}
      ringStyles={ringStyles}
      onSelect={handleNoteSelect}
      onNameChange={handleNameChange}
      onContentChange={handleContentChange}
      onHeightChange={setBlockHeight}
      onExpandedChange={handleExpandedChange}
      renderContentEditor={renderNoteContentEditor}
      actionBar={
        <ActionBar
          blockId={id}
          blockType={type}
          disabled={!canEditWorkflow}
          variant='swell'
          isWorkflowRunning={isWorkflowRunning}
          noteColor={noteColor}
          onNoteColorChange={handleColorChange}
          onNoteColorMenuOpen={handleNoteSelect}
        />
      }
    />
  )
})
