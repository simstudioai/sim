'use client'

import { type DragEvent, useCallback, useMemo, useRef, useState } from 'react'
import {
  readRowDragPayload,
  writeRowDragPayload,
} from '@/app/workspace/[workspaceId]/components/folders/drag-payload'
import { parseFolderedRowId } from '@/app/workspace/[workspaceId]/components/folders/folder-row-id'
import { useDragTeardown } from '@/app/workspace/[workspaceId]/components/folders/use-drag-teardown'
import { useRowDragGhost } from '@/app/workspace/[workspaceId]/components/folders/use-row-drag-ghost'
import {
  type SpringOpenOptions,
  useSpringLoadedFolder,
} from '@/app/workspace/[workspaceId]/components/folders/use-spring-loaded-folder'
import type { RowDragDropConfig } from '@/app/workspace/[workspaceId]/components/resource/resource'

/** The foldered-list drag MIME — see {@link writeRowDragPayload} for why each surface owns one. */
const DRAG_ROW_MIME = 'application/x-sim-foldered-row'

/** Stands in for an absent spring-open callback, so the timer hook needs no null handling. */
function noop() {}

/** Shared empty set so an idle drag state keeps a stable identity across renders. */
const EMPTY_ROW_IDS = new Set<string>()

/** Rows carried by one drag, already split by kind and stripped of no-op moves. */
export interface FolderedRowMove {
  folderIds: string[]
  resourceIds: string[]
}

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
  /**
   * Moves every row of the drag into `targetFolderId` in one call (`null` is the workspace
   * root). Rows already sitting directly in the target are filtered out before this fires, and
   * it is never called with both lists empty — so the consumer maps it straight onto its
   * bulk-move operations.
   */
  onMoveRows: (rows: FolderedRowMove, targetFolderId: string | null) => void
  /**
   * Checkbox selection, when the list has one. Dragging a selected row carries the whole
   * selection; dragging an unselected row collapses the selection onto it first, matching
   * every file manager. Omit on a list without selection to keep drags single-row.
   */
  selection?: {
    selectedRowIds: Set<string>
    /** Row ids in display order, so the drag carries them in the order they are read. */
    visibleRowIds: string[]
    /** Collapses the selection onto a single row dragged from outside it. */
    replaceSelection: (rowIds: string[]) => void
  }
  /**
   * Opens a folder the drag has rested on, so the user can file into a nested folder without
   * dropping first. Forward `options` to the folder-navigation setter so one drag leaves one
   * back-stack entry. Omit to disable spring-loading. See {@link useSpringLoadedFolder}.
   */
  onSpringOpenFolder?: (folderId: string, options: SpringOpenOptions) => void
  /**
   * The folder the list is currently showing (`null` at the workspace root). Enables dropping
   * onto the list body to file into it — the only way to land a drag that spring-opened into an
   * empty folder, which has no row to drop on.
   */
  currentFolderId?: string | null
}

/**
 * Drag-a-row-onto-a-folder-row moves for a foldered resource list, shared so Knowledge and
 * Tables behave exactly like Files: only folder rows accept a drop, a folder cannot land in
 * itself or its own subtree, and a row already sitting directly in the target is a no-op.
 *
 * Carries a whole checkbox selection when `selection` is supplied, and a single row otherwise.
 * The Files page keeps its own configuration because it additionally accepts external OS file
 * drops, which need a second drag protocol this hook deliberately does not know about.
 */
export function useFolderRowDragDrop({
  canEdit,
  editingRowId,
  descendantsByFolderId,
  getFolderParentId,
  getResourceFolderId,
  getRowLabel,
  onMoveRows,
  selection,
  onSpringOpenFolder,
  currentFolderId = null,
}: UseFolderRowDragDropOptions): RowDragDropConfig {
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null)
  const [isBodyDropActive, setIsBodyDropActive] = useState(false)
  const [draggedRowIds, setDraggedRowIds] = useState<Set<string>>(() => EMPTY_ROW_IDS)
  /**
   * The in-flight drag source, mirrored outside React state because `onDragOver` fires far
   * faster than a re-render and must decide drop validity against the current source
   * synchronously.
   */
  const draggedRowIdsRef = useRef<string[]>([])

  const optionsRef = useRef({
    descendantsByFolderId,
    getFolderParentId,
    getResourceFolderId,
    getRowLabel,
    onMoveRows,
    selection,
  })
  optionsRef.current = {
    descendantsByFolderId,
    getFolderParentId,
    getResourceFolderId,
    getRowLabel,
    onMoveRows,
    selection,
  }

  const springLoad = useSpringLoadedFolder({ onSpringOpen: onSpringOpenFolder ?? noop })

  const dragGhost = useRowDragGhost()

  /** Returns the list to its resting state once a drag is over, however it ended. */
  const endDrag = useCallback(() => {
    dragGhost.remove()
    draggedRowIdsRef.current = []
    springLoad.reset()
    setDraggedRowIds(EMPTY_ROW_IDS)
    setActiveDropTargetId(null)
    setIsBodyDropActive(false)
  }, [dragGhost, springLoad])

  useDragTeardown(endDrag)

  /**
   * Splits the drag into the rows that would actually move into `targetFolderId`, dropping any
   * row already sitting directly there. `null` when the drop is illegal outright — the target is
   * one of the dragged folders or inside one, which would orphan a subtree into itself — or when
   * nothing would actually change.
   *
   * Takes a folder id rather than a row id because the destination is not always a row: the
   * list body files into the folder currently open, which has no row of its own, and `null`
   * addresses the workspace root.
   */
  const resolveMoveToFolder = useCallback(
    (targetFolderId: string | null, sourceRowIds: string[]): FolderedRowMove | null => {
      const { descendantsByFolderId, getFolderParentId, getResourceFolderId } = optionsRef.current
      const folderIds: string[] = []
      const resourceIds: string[] = []

      for (const sourceRowId of sourceRowIds) {
        const source = parseFolderedRowId(sourceRowId)
        if (source.kind === 'folder') {
          if (source.id === targetFolderId) return null
          if (targetFolderId !== null && descendantsByFolderId.get(source.id)?.has(targetFolderId))
            return null
          if ((getFolderParentId(source.id) ?? null) === targetFolderId) continue
          folderIds.push(source.id)
          continue
        }
        if ((getResourceFolderId(source.id) ?? null) === targetFolderId) continue
        resourceIds.push(source.id)
      }

      if (folderIds.length === 0 && resourceIds.length === 0) return null
      return { folderIds, resourceIds }
    },
    []
  )

  /** Row-targeted drop: only a folder row can receive one. */
  const resolveMove = useCallback(
    (targetRowId: string, sourceRowIds: string[]): FolderedRowMove | null => {
      const target = parseFolderedRowId(targetRowId)
      if (target.kind !== 'folder') return null
      return resolveMoveToFolder(target.id, sourceRowIds)
    },
    [resolveMoveToFolder]
  )

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

        const { selection } = optionsRef.current
        /**
         * Read the selection in display order rather than insertion order, so a shift-range
         * drag carries its rows the way the user sees them.
         */
        const sourceRowIds = selection?.selectedRowIds.has(rowId)
          ? selection.visibleRowIds.filter((visibleRowId) =>
              selection.selectedRowIds.has(visibleRowId)
            )
          : [rowId]
        if (selection && !selection.selectedRowIds.has(rowId)) selection.replaceSelection([rowId])

        draggedRowIdsRef.current = sourceRowIds
        setDraggedRowIds(new Set(sourceRowIds))

        e.dataTransfer.effectAllowed = 'move'
        writeRowDragPayload(e.dataTransfer, DRAG_ROW_MIME, sourceRowIds)

        dragGhost.attach(e, optionsRef.current.getRowLabel(sourceRowIds[0]), sourceRowIds.length)
      },
      onDragOver: (e: DragEvent<HTMLDivElement>, rowId) => {
        const sourceRowIds = draggedRowIdsRef.current
        if (sourceRowIds.length > 0) {
          if (!resolveMove(rowId, sourceRowIds)) return
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
        if (sourceRowIds.length > 0) {
          setActiveDropTargetId(rowId)
          /**
           * Armed on the same condition as the highlight, so a folder only springs open where a
           * drop was already possible. A folder the drag cannot legally enter never opens.
           */
          springLoad.arm(parseFolderedRowId(rowId).id)
        }
      },
      onDragLeave: (e: DragEvent<HTMLDivElement>, rowId) => {
        const relatedTarget = e.relatedTarget
        if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) return
        springLoad.disarm()
        setActiveDropTargetId((current) => (current === rowId ? null : current))
      },
      onDrop: (e: DragEvent<HTMLDivElement>, rowId) => {
        e.preventDefault()
        e.stopPropagation()

        const target = parseFolderedRowId(rowId)
        // Prefer the dataTransfer payload over the ref so a drag that started in another
        // mount of this page still resolves to real row ids.
        const sourceRowIds =
          readRowDragPayload(e.dataTransfer, DRAG_ROW_MIME) ?? draggedRowIdsRef.current
        const move =
          target.kind === 'folder' && sourceRowIds.length > 0
            ? resolveMove(rowId, sourceRowIds)
            : null

        /**
         * Ends the drag here rather than leaving it to `dragend`. This handler stops
         * propagation, so the window-level backstop never sees this drop, and the source row
         * may already have unmounted — after a spring-open it always has.
         */
        endDrag()

        if (move) optionsRef.current.onMoveRows(move, target.id)
      },
      onDragEnd: endDrag,
      body: {
        isActive: isBodyDropActive,
        canDrop: canEdit && draggedRowIds.size > 0,
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          const sourceRowIds = draggedRowIdsRef.current
          if (sourceRowIds.length === 0) return
          /**
           * Only light up when the drop would actually move something. A drag whose rows all
           * already live here is a no-op, and showing a target for it would promise a change
           * that never happens.
           */
          if (!resolveMoveToFolder(currentFolderId, sourceRowIds)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setIsBodyDropActive(true)
        },
        onDragLeave: (e: DragEvent<HTMLDivElement>) => {
          const relatedTarget = e.relatedTarget
          if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) return
          setIsBodyDropActive(false)
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          const sourceRowIds =
            readRowDragPayload(e.dataTransfer, DRAG_ROW_MIME) ?? draggedRowIdsRef.current
          const move =
            sourceRowIds.length > 0 ? resolveMoveToFolder(currentFolderId, sourceRowIds) : null
          endDrag()
          if (move) optionsRef.current.onMoveRows(move, currentFolderId)
        },
      },
    }),
    [
      activeDropTargetId,
      draggedRowIds,
      canEdit,
      editingRowId,
      resolveMove,
      springLoad,
      endDrag,
      dragGhost,
    ]
  )
}
