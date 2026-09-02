import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BLOCK_DIMENSIONS,
  countNoteSearchOccurrencesBefore,
  DEFAULT_NOTE_COLOR,
  estimateNoteBlockHeight,
  forEachNoteSourceOccurrence,
  getNoteStringValue,
  isNoteColor,
  NoteBlockView,
  type NoteColor,
  type NoteContentEditorProps,
  type NoteSearchHighlight,
  type NoteSearchRange,
} from '@sim/workflow-renderer'
import { type Node, type NodeProps, useReactFlow } from '@xyflow/react'
import dynamic from 'next/dynamic'
import { useShallow } from 'zustand/react/shallow'
import { appendNoteImageMarkdown } from '@/lib/workflows/notes/add-image'
import {
  NOTE_ADD_IMAGE_EVENT,
  NOTE_RENAME_EVENT,
  type NoteBlockRequestDetail,
} from '@/lib/workflows/notes/canvas-requests'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ActionBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar'
import { useNoteImageUpload } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/use-note-image-upload'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useBlockDimensions } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { isBlockProtected } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useIsCurrentWorkflowExecuting } from '@/stores/execution'
import { usePanelEditorSearchStore, usePanelEditorStore } from '@/stores/panel'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface NoteBlockNodeData extends WorkflowBlockProps {}

type NoteBlockNode = Node<NoteBlockNodeData, 'noteBlock'>

/**
 * Lazy for the same reason every other consumer of the markdown field is: it
 * carries TipTap and the full extension set, and a Note only mounts it once the
 * user clicks into the body. A static import would put all of that in the
 * canvas's initial chunk, which every workflow pays for.
 */
const NoteMarkdownEditor = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-markdown-editor'
    ).then((m) => m.NoteMarkdownEditor),
  { ssr: false, loading: () => <div className='min-h-full w-full' /> }
)

const NOTE_EXPAND_FOCUS_DURATION_MS = 300

/** The markdown body's sub-block id, as declared by the Note block config. */
const NOTE_CONTENT_SUBBLOCK_ID = 'content'

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
export const NoteBlock = memo(function NoteBlock({ id, data, selected }: NodeProps<NoteBlockNode>) {
  const { type, name } = data
  const focusFrameRef = useRef<number | null>(null)
  const { getInternalNode, getViewport, setCenter } = useReactFlow()

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
  /* Flattened to primitives under a shallow compare, never held as the target
     object: the search panel re-publishes an equal target on most of its own
     renders, and a card that subscribes to the object rebuilds its highlight on
     every one of them. */
  const searchTarget = usePanelEditorSearchStore(
    useShallow((state) => {
      const target = state.activeSearchTarget
      return {
        blockId: target?.blockId ?? null,
        subBlockId: target?.subBlockId ?? null,
        targetKind: target?.targetKind ?? null,
        query: target?.query ?? null,
        rawValue: target?.rawValue ?? null,
        rangeStart: target?.range?.start ?? null,
        rangeEnd: target?.range?.end ?? null,
      }
    })
  )
  const canEditNote = canEditWorkflow && !data.isPreview && !isProtected

  /** Whether the active search match belongs to this card at all. */
  const isSearchTargetBlock =
    !data.isPreview &&
    !data.isEmbedded &&
    searchTarget.blockId === id &&
    Boolean(searchTarget.query)

  /**
   * The workflow search match this card should paint in its body.
   *
   * The panel editor renders nothing for a note, so the card is the only
   * surface that can answer a search — without this a note match counts towards
   * "1 of 6" and then highlights nowhere.
   *
   * The stored range is re-checked against the live content before it is
   * trusted: the index runs over a snapshot, and a collaborator's edit between
   * indexing and painting would shift the ordinal onto the wrong words. When it
   * no longer holds — or the match never carried one — this falls back to the
   * first rendered occurrence, which is the same fallback the editor panel
   * makes for a label whose stored range does not fit.
   */
  const searchHighlight = useMemo<NoteSearchHighlight | null>(() => {
    if (!isSearchTargetBlock) return null
    if (searchTarget.targetKind !== 'subblock') return null
    if (searchTarget.subBlockId !== NOTE_CONTENT_SUBBLOCK_ID) return null

    const { query, rawValue, rangeStart, rangeEnd } = searchTarget
    if (!query) return null

    const rangeHolds =
      rangeStart !== null && rangeEnd !== null && content.slice(rangeStart, rangeEnd) === rawValue
    if (rangeHolds) {
      return {
        query,
        occurrenceIndex: countNoteSearchOccurrencesBefore(content, query, rangeStart),
      }
    }

    /* Asked through the same scan that will do the marking, rather than a local
       `includes`: a bare comparison skips the whitespace fold, so a query the
       indexer matched across a newline or a non-breaking space would read as
       absent here and the card would paint nothing while the panel counted it. */
    let occurs = false
    forEachNoteSourceOccurrence(content, query, () => {
      occurs = true
    })
    return occurs ? { query, occurrenceIndex: 0 } : null
  }, [content, isSearchTargetBlock, searchTarget])

  /**
   * The match to paint in the title, for a search that hit the note's name.
   *
   * A name match carries an exact range over `block.name`, so unlike the body
   * there is no occurrence to reconstruct — it is used directly, once it still
   * describes the live name.
   */
  const nameSearchRange = useMemo<NoteSearchRange | null>(() => {
    if (!isSearchTargetBlock) return null
    if (searchTarget.targetKind !== 'block-name') return null

    const { rawValue, rangeStart, rangeEnd } = searchTarget
    if (rangeStart === null || rangeEnd === null) return null
    if ((name ?? '').slice(rangeStart, rangeEnd) !== rawValue) return null

    return { start: rangeStart, end: rangeEnd }
  }, [isSearchTargetBlock, name, searchTarget])
  const uploadNoteImage = useNoteImageUpload()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [blockHeight, setBlockHeight] = useState(() => estimateNoteBlockHeight(content))
  const [isExpanded, setIsExpanded] = useState(false)
  const [externalContentWrites, setExternalContentWrites] = useState(0)
  const [renameRequests, setRenameRequests] = useState(0)
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

  const isExpandedRef = useRef(isExpanded)
  useEffect(() => {
    isExpandedRef.current = isExpanded
  }, [isExpanded])

  /**
   * Opens the card while it holds the current search match, and closes it again
   * when the match moves on.
   *
   * A compact note shows a few lines of what is often a long document, so a
   * match found deep inside it lands in a body the user cannot read. Expanding
   * is the same gesture a click makes, and it gives the mark somewhere to be.
   *
   * Two things this deliberately does not do. It does not call
   * {@link handleExpandedChange}, whose own `setCenter` would race the camera
   * the canvas already moved for this match. And it only closes a card it
   * opened — a note the user expanded by hand, or collapsed by hand while the
   * match still points here, is left exactly as they left it.
   */
  const searchExpandedRef = useRef(false)
  const hasSearchMatch = searchHighlight !== null || nameSearchRange !== null
  useEffect(() => {
    /* Losing edit rights already force-collapses the card during render. Drop the latch with it,
       or regaining them would hit the early return below and leave a deep match clipped in the
       compact body until the active match moved. */
    if (!canEditNote) {
      searchExpandedRef.current = false
      return
    }

    if (hasSearchMatch) {
      if (searchExpandedRef.current || isExpandedRef.current) return
      searchExpandedRef.current = true
      setIsExpanded(true)
      return
    }

    if (!searchExpandedRef.current) return
    searchExpandedRef.current = false
    setIsExpanded(false)
  }, [canEditNote, hasSearchMatch])

  const handleNameChange = (nextName: string) => {
    if (!canEditNote) return false
    return collaborativeUpdateBlockName(id, nextName).success
  }

  const handleContentChange = (nextContent: string) => {
    if (!canEditNote) return
    collaborativeSetSubblockValue(id, NOTE_CONTENT_SUBBLOCK_ID, nextContent)
  }

  /**
   * "Add image" from the canvas context menu. The picker, the upload and the
   * write all live here because the note's content is the thing being changed —
   * the editor may not even be mounted, and routing through it would mean
   * opening one just to insert.
   */
  useEffect(() => {
    if (!canEditNote) return
    const handleAddImage = (event: Event) => {
      const detail = (event as CustomEvent<NoteBlockRequestDetail>).detail
      if (detail?.blockId !== id) return
      imageInputRef.current?.click()
    }
    window.addEventListener(NOTE_ADD_IMAGE_EVENT, handleAddImage)
    return () => window.removeEventListener(NOTE_ADD_IMAGE_EVENT, handleAddImage)
  }, [canEditNote, id])

  /**
   * Uploads then appends, one image at a time so a multi-file pick or drop lands
   * in order. Each write goes to the store rather than to a mounted editor, so
   * it counts as an external one: bumping `externalContentWrites` hands the
   * document back to `content` first, or an open editor's next keystroke would
   * serialize its own stale document over the appended image.
   *
   * Shared by both surfaces that reach the note from outside its editor: the
   * context menu's "Add image" and a file dropped onto the card.
   */
  const insertImages = async (files: File[]) => {
    for (const file of files) {
      const image = await uploadNoteImage(file)
      if (!image) continue
      /* Re-read per image: each append has to build on the previous one, and on
         anything a collaborator wrote while the upload was in flight. */
      const current =
        getNoteStringValue(useSubBlockStore.getState().getValue(id, NOTE_CONTENT_SUBBLOCK_ID)) ?? ''
      setExternalContentWrites((count) => count + 1)
      collaborativeSetSubblockValue(
        id,
        NOTE_CONTENT_SUBBLOCK_ID,
        appendNoteImageMarkdown(current, image)
      )
    }
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
          const position = getInternalNode(id)?.internals.positionAbsolute
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
    [blockHeight, canEditNote, getInternalNode, getViewport, handleNoteSelect, id, setCenter]
  )

  /**
   * "Rename" from the canvas context menu. The panel editor is not an option —
   * it clears any note put in front of it and renders nothing — so the card's
   * own title is the rename surface. That title is only reachable once the card
   * is expanded, which is why this expands first and asks second.
   */
  useEffect(() => {
    if (!canEditNote) return
    const handleRename = (event: Event) => {
      const detail = (event as CustomEvent<NoteBlockRequestDetail>).detail
      if (detail?.blockId !== id) return
      handleExpandedChange(true)
      setRenameRequests((count) => count + 1)
    }
    window.addEventListener(NOTE_RENAME_EVENT, handleRename)
    return () => window.removeEventListener(NOTE_RENAME_EVENT, handleRename)
  }, [canEditNote, handleExpandedChange, id])

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
    <>
      <input
        ref={imageInputRef}
        type='file'
        accept='image/*'
        multiple
        hidden
        onChange={(event) => {
          const input = event.currentTarget
          const images = Array.from(input.files ?? []).filter((file) =>
            file.type.startsWith('image/')
          )
          input.value = ''
          if (images.length > 0) void insertImages(images)
        }}
      />
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
        externalContentWrites={externalContentWrites}
        externalRenameRequests={renameRequests}
        onHeightChange={setBlockHeight}
        onExpandedChange={handleExpandedChange}
        onImageFilesDrop={(files) => void insertImages(files)}
        renderContentEditor={renderNoteContentEditor}
        searchHighlight={searchHighlight}
        nameSearchRange={nameSearchRange}
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
    </>
  )
})
