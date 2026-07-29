'use client'

import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseFolderedRowId } from '@/app/workspace/[workspaceId]/components/folders/folder-row-id'
import type { RowDragDropConfig } from '@/app/workspace/[workspaceId]/components/resource/resource'

/**
 * Private drag payload, namespaced so a drag started on another Sim surface (or an external
 * drag) is never mistaken for a foldered list row.
 */
const DRAG_ROW_MIME = 'application/x-sim-foldered-row'

const DRAG_GHOST_STYLE =
  'position:fixed;top:-500px;left:0;display:inline-flex;align-items:center;padding:4px 10px;background:var(--surface-active);border:1px solid var(--border);border-radius:8px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:var(--text-body);white-space:nowrap;pointer-events:none;box-shadow:var(--shadow-medium);z-index:var(--z-toast)'

/** Shared empty set so an idle drag state keeps a stable identity across renders. */
const EMPTY_ROW_IDS = new Set<string>()

export interface UseFolderRowDragDropOptions {
  /** Drag and drop are edits; a reader gets neither draggable rows nor drop targets. */
  canEdit: boolean
  /** Row currently being renamed inline, which must stay editable rather than draggable. */
  editingRowId: string | null
  /** Transitive descendants of each folder, from `buildDescendantIndex`. */
  descendantsByFolderId: Map<string, Set<string>>
  /** Current `parentId` of a folder in this tree, for rejecting a no-op drop. */
  getFolderParentId: (folderId: string) => string | null | undefined
  /** Current `folderId` of a resource row, for rejecting a no-op drop. */
  getResourceFolderId: (resourceId: string) => string | null | undefined
  /** Label shown in the drag ghost. */
  getRowLabel: (rowId: string) => string
  /** Reparents a folder into `targetFolderId`. */
  onMoveFolder: (folderId: string, targetFolderId: string) => void
  /** Files a resource into `targetFolderId`. */
  onMoveResource: (resourceId: string, targetFolderId: string) => void
}

/**
 * Drag-a-row-onto-a-folder-row moves for a foldered resource list, shared so Knowledge and
 * Tables behave exactly like Files: only folder rows accept a drop, a folder cannot land in
 * itself or its own subtree, and a row already sitting directly in the target is a no-op.
 *
 * Single-row only, which is what the resource lists that use it support. The Files page
 * keeps its own configuration because it additionally drags multi-selections and accepts
 * external OS file drops.
 */
export function useFolderRowDragDrop({
  canEdit,
  editingRowId,
  descendantsByFolderId,
  getFolderParentId,
  getResourceFolderId,
  getRowLabel,
  onMoveFolder,
  onMoveResource,
}: UseFolderRowDragDropOptions): RowDragDropConfig {
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null)
  const [draggedRowIds, setDraggedRowIds] = useState<Set<string>>(() => EMPTY_ROW_IDS)
  /**
   * The in-flight drag source, mirrored outside React state because `onDragOver` fires far
   * faster than a re-render and must decide drop validity against the current source
   * synchronously.
   */
  const draggedRowIdRef = useRef<string | null>(null)
  const dragGhostRef = useRef<HTMLElement | null>(null)

  const optionsRef = useRef({
    descendantsByFolderId,
    getFolderParentId,
    getResourceFolderId,
    getRowLabel,
    onMoveFolder,
    onMoveResource,
  })
  optionsRef.current = {
    descendantsByFolderId,
    getFolderParentId,
    getResourceFolderId,
    getRowLabel,
    onMoveFolder,
    onMoveResource,
  }

  /**
   * The ghost lives on `document.body`, but the only thing that removes it is `dragend`, which
   * fires on the SOURCE ROW. `Resource.Table` is virtualized, so scrolling the source out of
   * view mid-drag unmounts that row and the event never arrives — leaving the ghost stuck on
   * the page and every row frozen at drag opacity. Clean up on unmount as the backstop.
   */
  useEffect(
    () => () => {
      dragGhostRef.current?.remove()
      dragGhostRef.current = null
    },
    []
  )

  const isInvalidDropTarget = useCallback((targetRowId: string, sourceRowId: string) => {
    const target = parseFolderedRowId(targetRowId)
    if (target.kind !== 'folder') return true

    const source = parseFolderedRowId(sourceRowId)
    if (source.kind === 'folder') {
      if (source.id === target.id) return true
      if (optionsRef.current.descendantsByFolderId.get(source.id)?.has(target.id)) return true
      return (optionsRef.current.getFolderParentId(source.id) ?? null) === target.id
    }
    return (optionsRef.current.getResourceFolderId(source.id) ?? null) === target.id
  }, [])

  return useMemo<RowDragDropConfig>(
    () => ({
      activeDropTargetId,
      draggedRowIds,
      isAnyDragActive: draggedRowIds.size > 0,
      isRowDraggable: (rowId) => canEdit && editingRowId !== rowId,
      isRowDropTarget: (rowId) => canEdit && parseFolderedRowId(rowId).kind === 'folder',
      onDragStart: (e: DragEvent<HTMLDivElement>, rowId) => {
        if (!canEdit || editingRowId === rowId) {
          e.preventDefault()
          return
        }

        draggedRowIdRef.current = rowId
        setDraggedRowIds(new Set([rowId]))

        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(DRAG_ROW_MIME, rowId)
        e.dataTransfer.setData('text/plain', rowId)

        const ghost = document.createElement('div')
        ghost.style.cssText = DRAG_GHOST_STYLE
        const text = document.createElement('span')
        text.style.cssText = 'max-width:200px;overflow:hidden;text-overflow:ellipsis'
        text.textContent = optionsRef.current.getRowLabel(rowId)
        ghost.appendChild(text)
        document.body.appendChild(ghost)
        // Force a layout pass so the drag image is measurable before it is captured.
        void ghost.offsetHeight
        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
        dragGhostRef.current = ghost
      },
      onDragOver: (e: DragEvent<HTMLDivElement>, rowId) => {
        const sourceRowId = draggedRowIdRef.current
        if (sourceRowId) {
          if (isInvalidDropTarget(rowId, sourceRowId)) return
        } else if (!e.dataTransfer.types.includes(DRAG_ROW_MIME)) {
          /**
           * No local source and no payload of ours — an external or foreign drag. Returning
           * without `preventDefault` leaves the browser's default handling in place, which is
           * what stops a dropped OS file from navigating the tab away from the app.
           */
          return
        }
        /**
         * `dataTransfer.getData` is empty during dragover by design (the drag data store is
         * protected until drop), so a drag that began in another mount of this page can only be
         * recognised by its MIME type here. `onDrop` re-checks validity with the real payload.
         */
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        /**
         * Highlight only when the source is known and was checked. Without it every folder
         * would light up as a valid target — including the dragged folder itself and its own
         * descendants — and the drop would then silently do nothing.
         */
        if (sourceRowId) setActiveDropTargetId(rowId)
      },
      onDragLeave: (e: DragEvent<HTMLDivElement>, rowId) => {
        const relatedTarget = e.relatedTarget
        if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) return
        setActiveDropTargetId((current) => (current === rowId ? null : current))
      },
      onDrop: (e: DragEvent<HTMLDivElement>, rowId) => {
        e.preventDefault()
        e.stopPropagation()
        setActiveDropTargetId(null)

        const target = parseFolderedRowId(rowId)
        if (target.kind !== 'folder') return

        // Prefer the dataTransfer payload over the ref so a drag that started in another
        // mount of this page still resolves to a real row id.
        const sourceRowId = e.dataTransfer.getData(DRAG_ROW_MIME) || draggedRowIdRef.current
        if (!sourceRowId || isInvalidDropTarget(rowId, sourceRowId)) return

        const source = parseFolderedRowId(sourceRowId)
        if (source.kind === 'folder') optionsRef.current.onMoveFolder(source.id, target.id)
        else optionsRef.current.onMoveResource(source.id, target.id)
      },
      onDragEnd: () => {
        dragGhostRef.current?.remove()
        dragGhostRef.current = null
        draggedRowIdRef.current = null
        setDraggedRowIds(EMPTY_ROW_IDS)
        setActiveDropTargetId(null)
      },
    }),
    [activeDropTargetId, draggedRowIds, canEdit, editingRowId, isInvalidDropTarget]
  )
}
