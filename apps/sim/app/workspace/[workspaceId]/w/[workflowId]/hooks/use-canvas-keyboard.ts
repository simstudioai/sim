import type React from 'react'
import { useEffect } from 'react'
import type { Edge, Node } from 'reactflow'
import {
  calculatePasteOffset,
  filterProtectedBlocks,
  isEdgeProtected,
  isInEditableElement,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import type { AddNotificationParams } from '@/stores/notifications'
import { usePanelEditorStore } from '@/stores/panel'
import type { BlockState } from '@/stores/workflows/workflow/types'

interface UseCanvasKeyboardProps {
  blocksRef: React.RefObject<Record<string, BlockState>>
  debouncedAutoLayout: () => () => void
  undo: () => void
  redo: () => void
  getNodes: () => Node[]
  copyBlocks: (ids: string[]) => void
  hasClipboard: () => boolean
  canEdit: boolean
  clipboard: {
    blocks: Record<string, { position: { x: number; y: number }; type: string; height?: number }>
  } | null
  getViewportCenter: () => { x: number; y: number }
  executePasteOperation: (
    operation: 'paste' | 'duplicate',
    pasteOffset: { x: number; y: number }
  ) => void
  selectedEdges: Map<string, string>
  setSelectedEdges: React.Dispatch<React.SetStateAction<Map<string, string>>>
  collaborativeBatchRemoveEdges: (edgeIds: string[], options?: Record<string, unknown>) => void
  collaborativeBatchRemoveBlocks: (blockIds: string[]) => void
  edges: Edge[]
  addNotification: (params: AddNotificationParams) => string
  activeWorkflowId: string | null
}

export function useCanvasKeyboard({
  blocksRef,
  debouncedAutoLayout,
  undo,
  redo,
  getNodes,
  copyBlocks,
  hasClipboard,
  canEdit,
  clipboard,
  getViewportCenter,
  executePasteOperation,
  selectedEdges,
  setSelectedEdges,
  collaborativeBatchRemoveEdges,
  collaborativeBatchRemoveBlocks,
  edges,
  addNotification,
  activeWorkflowId,
}: UseCanvasKeyboardProps): void {
  useEffect(() => {
    let cleanup: (() => void) | null = null

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInEditableElement()) {
        event.stopPropagation()
        return
      }

      if (event.shiftKey && event.key === 'L' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        if (cleanup) cleanup()
        cleanup = debouncedAutoLayout()
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === 'Z' || (event.key === 'z' && event.shiftKey))
      ) {
        event.preventDefault()
        redo()
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        const selection = window.getSelection()
        const hasTextSelection = selection && selection.toString().length > 0

        if (hasTextSelection) {
          return
        }

        const selectedNodes = getNodes().filter((node) => node.selected)
        if (selectedNodes.length > 0) {
          event.preventDefault()
          copyBlocks(selectedNodes.map((node) => node.id))
        } else {
          const currentBlockId = usePanelEditorStore.getState().currentBlockId
          if (currentBlockId && blocksRef.current[currentBlockId]) {
            event.preventDefault()
            copyBlocks([currentBlockId])
          }
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        if (canEdit && hasClipboard()) {
          event.preventDefault()
          executePasteOperation('paste', calculatePasteOffset(clipboard, getViewportCenter()))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (cleanup) cleanup()
    }
  }, [
    debouncedAutoLayout,
    undo,
    redo,
    getNodes,
    copyBlocks,
    hasClipboard,
    canEdit,
    clipboard,
    getViewportCenter,
    executePasteOperation,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }

      if (isInEditableElement()) {
        return
      }

      if (selectedEdges.size > 0) {
        const currentBlocks = blocksRef.current
        const edgeIds = Array.from(selectedEdges.values()).filter((edgeId: string) => {
          const edge = edges.find((e) => e.id === edgeId)
          if (!edge) return true
          return !isEdgeProtected(edge, currentBlocks)
        })
        if (edgeIds.length > 0) {
          collaborativeBatchRemoveEdges(edgeIds)
        }
        setSelectedEdges(new Map())
        return
      }

      if (!canEdit) {
        return
      }

      const selectedNodes = getNodes().filter((node) => node.selected)
      if (selectedNodes.length === 0) {
        return
      }

      event.preventDefault()
      const selectedIds = selectedNodes.map((node) => node.id)
      const currentBlocks = blocksRef.current
      const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(
        selectedIds,
        currentBlocks
      )

      if (protectedIds.length > 0) {
        if (allProtected) {
          addNotification({
            level: 'info',
            message: 'Cannot delete locked blocks or blocks inside locked containers',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }
        addNotification({
          level: 'info',
          message: `Skipped ${protectedIds.length} protected block(s)`,
          workflowId: activeWorkflowId || undefined,
        })
      }
      if (deletableIds.length > 0) {
        collaborativeBatchRemoveBlocks(deletableIds)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedEdges,
    collaborativeBatchRemoveEdges,
    getNodes,
    collaborativeBatchRemoveBlocks,
    canEdit,
    edges,
    addNotification,
    activeWorkflowId,
    setSelectedEdges,
  ])
}
