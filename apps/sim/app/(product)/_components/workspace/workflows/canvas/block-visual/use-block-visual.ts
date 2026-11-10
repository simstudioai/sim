import { useCallback, useMemo } from 'react'
import {
  useBlockCurrentWorkflow,
  useBlockState,
  useLastRunPath,
  usePanelEditorStore,
  usePanelStore,
  useWorkflowRegistry,
  type WorkflowBlockProps,
} from '@/platform/lib/data/workflows'

/**
 * The ring a block card paints, in legacy priority order: the neutral selection ring (editor open,
 * selected, or preview selection), then pending. Subflow containers also take the status rings for
 * version-comparison diffs and preview run outcomes. Each card's CSS paints it from `data-ring` with
 * the legacy 1.5px ring.
 */
export type BlockRing = 'selected' | 'pending' | 'deleted' | 'new' | 'edited'

interface BlockRingOptions {
  isExecuting: boolean
  isEditorOpen: boolean
  isPending: boolean
  isPreviewSelection?: boolean
  isSelected?: boolean
}

/** The legacy `getBlockRingStyles` decision, as a value instead of Tailwind classes. */
function blockRing({
  isExecuting,
  isEditorOpen,
  isPending,
  isPreviewSelection,
  isSelected,
}: BlockRingOptions): BlockRing | null {
  if (isEditorOpen || isSelected || isPreviewSelection) return 'selected'
  if (isExecuting) return null
  if (isPending) return 'pending'
  return null
}

interface UseBlockVisualProps {
  blockId: string
  data: WorkflowBlockProps
  isPending?: boolean
  /** Selected by shift-click or the selection box. */
  isSelected?: boolean
}

/**
 * The legacy `useBlockVisual`: a block's enabled, executing and locked state, its click handler (which
 * opens it in the editor) and its ring. The ring shows while the editor panel is open on this block,
 * not while it is merely being dragged.
 */
export function useBlockVisual({
  blockId,
  data,
  isPending = false,
  isSelected = false,
}: UseBlockVisualProps) {
  const isPreview = data.isPreview ?? false
  const isEmbedded = data.isEmbedded ?? false
  const isPreviewSelected = data.isPreviewSelected ?? false

  const currentWorkflow = useBlockCurrentWorkflow(blockId)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const {
    isEnabled,
    isActive: isExecuting,
    isLocked,
  } = useBlockState(blockId, currentWorkflow, data)

  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const isThisBlockInEditor = currentBlockId === blockId
  const activeTabIsEditor = usePanelStore(
    useCallback(
      (state) => {
        if (isPreview || isEmbedded || !isThisBlockInEditor) return false
        return state.activeTab === 'editor'
      },
      [isPreview, isEmbedded, isThisBlockInEditor]
    )
  )
  const isEditorOpen = !isPreview && !isEmbedded && isThisBlockInEditor && activeTabIsEditor

  const lastRunPath = useLastRunPath()
  const runPathStatus = isPreview ? undefined : lastRunPath.get(blockId)

  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const handleClick = useCallback(() => {
    if (!isPreview && !isEmbedded) setCurrentBlockId(blockId)
  }, [blockId, setCurrentBlockId, isPreview, isEmbedded])

  const ring = useMemo(
    () =>
      blockRing({
        isExecuting: isPreview ? false : isExecuting,
        isEditorOpen: isPreview ? isPreviewSelected : isEditorOpen,
        isPending: isPreview ? false : isPending,
        isPreviewSelection: isPreview && isPreviewSelected,
        isSelected: isPreview || isEmbedded ? false : isSelected,
      }),
    [isExecuting, isEditorOpen, isPending, isPreview, isEmbedded, isPreviewSelected, isSelected]
  )

  return {
    currentWorkflow,
    activeWorkflowId,
    isEnabled,
    isExecuting,
    isLocked,
    handleClick,
    hasRing: ring !== null,
    ring,
    runPathStatus,
  }
}
