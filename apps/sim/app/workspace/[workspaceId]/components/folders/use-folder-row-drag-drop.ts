'use client'

import { type DragEvent, useCallback, useMemo, useRef, useState } from 'react'
import {
  readRowDragPayload,
  writeRowDragPayload,
} from '@/app/workspace/[workspaceId]/components/folders/drag-payload'
import { parseFolderedRowId } from '@/app/workspace/[workspaceId]/components/folders/folder-row-id'
import { useDragTeardown } from '@/app/workspace/[workspaceId]/components/folders/use-drag-teardown'
import { useRowDragGhost } from '@/app/workspace/[workspaceId]/components/folders/use-row-drag-ghost'
import type { SpringOpenOptions } from '@/app/workspace/[workspaceId]/components/folders/use-spring-loaded-folder'
import { useSpringNavigation } from '@/app/workspace/[workspaceId]/components/folders/use-spring-navigation'
import type { RowDragDropConfig } from '@/app/workspace/[workspaceId]/components/resource/resource'

/**
 * What the hook hands back: the render contract `Resource` consumes, plus the one signal that is
 * not a rendering concern.
 */
export interface FolderRowDragDrop extends RowDragDropConfig {
  /**
   * Reports that a page-level overlay consumed an external drop, so spring navigation keeps the
   * folder it opened instead of returning to where the drag started. Only a surface that owns a
   * whole-page drop target needs this; row, body, and breadcrumb drops report themselves.
   */
  externalDropHandled: () => void
}

/** Shared empty set so an idle drag state keeps a stable identity across renders. */
const EMPTY_ROW_IDS = new Set<string>()

/**
 * The one surface currently reading as "release here".
 *
 * A union rather than three booleans because the three targets are mutually exclusive: a row,
 * the list body, and a breadcrumb crumb can never be armed together. As separate flags every
 * handler had to hand-clear the other two, and where a `dragleave` does not fire — a row lives
 * inside the scroll container, so moving onto it leaves that container with a contained
 * `relatedTarget` its handler ignores — two affordances could paint at once. Here exactly one
 * is armed by construction.
 */
type ActiveDropTarget =
  | { kind: 'row'; rowId: string }
  | { kind: 'body' }
  | { kind: 'crumb'; index: number }

/**
 * Arms `next`, reusing the current value when it already names the same target.
 *
 * `dragover` fires continuously — several times a second even with the pointer still — so a
 * fresh object per event would re-render the whole list and rebuild the memoized config every
 * time. Returning `current` unchanged lets React bail on `Object.is`, which is what the plain
 * string this union replaced used to get for free.
 */
function armDropTarget(
  current: ActiveDropTarget | null,
  next: ActiveDropTarget
): ActiveDropTarget | null {
  if (current?.kind !== next.kind) return next
  switch (next.kind) {
    case 'row':
      return current.kind === 'row' && current.rowId === next.rowId ? current : next
    case 'crumb':
      return current.kind === 'crumb' && current.index === next.index ? current : next
    default:
      return current
  }
}

/** Rows carried by one drag, already split by kind and stripped of no-op moves. */
export interface FolderedRowMove {
  folderIds: string[]
  resourceIds: string[]
}

/**
 * Drops every row that one of the dragged folders already carries.
 *
 * Moving a folder takes its contents with it, so naming both a folder and something inside it
 * would move the parent AND separately pull the child out of it: the two land as siblings and
 * the hierarchy the user dragged is gone. The folder wins, because it is the thing they
 * grabbed the outside of.
 *
 * Only reachable since search began returning rows from across the workspace — a list showing
 * one folder's direct children can never show a row alongside its own ancestor.
 */
export function dropRowsCarriedByDraggedFolders(
  move: FolderedRowMove,
  {
    descendantsByFolderId,
    getFolderParentId,
    getResourceFolderId,
  }: {
    descendantsByFolderId: Map<string, Set<string>>
    getFolderParentId: (folderId: string) => string | null | undefined
    getResourceFolderId: (resourceId: string) => string | null | undefined
  }
): FolderedRowMove {
  const draggedFolderIds = new Set(move.folderIds)
  if (draggedFolderIds.size === 0) return move

  const isCarried = (ownerFolderId: string | null | undefined): boolean => {
    if (!ownerFolderId) return false
    for (const folderId of draggedFolderIds) {
      if (ownerFolderId === folderId) return true
      if (descendantsByFolderId.get(folderId)?.has(ownerFolderId)) return true
    }
    return false
  }

  return {
    folderIds: move.folderIds.filter((id) => !isCarried(getFolderParentId(id))),
    resourceIds: move.resourceIds.filter((id) => !isCarried(getResourceFolderId(id))),
  }
}

export interface UseFolderRowDragDropOptions {
  /**
   * This list's private drag MIME. Each surface owns one so a drag started in another list is
   * never mistaken for one of these rows — see {@link writeRowDragPayload}.
   */
  dragMime: string
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
   * back-stack entry. Omit to disable spring-loading. See {@link useSpringNavigation}.
   */
  onSpringOpenFolder?: (folderId: string | null, options: SpringOpenOptions) => void
  /**
   * The folder the list is currently showing (`null` at the workspace root). Enables dropping
   * onto the list body to file into it — the only way to land a drag that spring-opened into an
   * empty folder, which has no row to drop on.
   */
  currentFolderId?: string | null
  /**
   * The folder the list body drops into, or `undefined` when the body does not stand for a
   * folder at all and must decline.
   *
   * It differs from {@link currentFolderId} whenever the visible rows are not that folder's
   * contents. Dropping on the blank area below the rows would then file a row into a folder
   * the drop UI never names — harmless when every row already lives there (the target
   * declines the no-op), destructive when they do not. A row drop is unaffected: that target
   * names its own destination.
   *
   * Required, and deliberately without a default: a destructuring default fires on an
   * explicit `undefined` too, so `= currentFolderId` would silently swallow the very value a
   * searching caller passes to decline and leave the guard unreachable.
   */
  bodyDropFolderId: string | null | undefined
  /**
   * OS file drops, which Files accepts and the other lists do not.
   *
   * When `matches` recognises the drag, folder rows still highlight and still spring open — the
   * gesture is the same, only the payload differs — but the internal move-validity gate is
   * skipped, and the body and breadcrumb decline so a page-level upload overlay owns those
   * regions rather than competing with it.
   */
  externalDrop?: {
    matches: (dataTransfer: DataTransfer) => boolean
    /** Files released on a folder row, to be uploaded into it. */
    onDropIntoFolder: (dataTransfer: DataTransfer, targetFolderId: string) => void
  }
}

/**
 * Drag-a-row-onto-a-folder-row moves for a foldered resource list, shared so Knowledge and
 * Tables behave exactly like Files: only folder rows accept a drop, a folder cannot land in
 * itself or its own subtree, and a row already sitting directly in the target is a no-op.
 *
 * Carries a whole checkbox selection when `selection` is supplied, and a single row otherwise.
 * Files layers OS file drops on top through `externalDrop`; the gesture is identical, only the
 * payload differs.
 */
export function useFolderRowDragDrop({
  dragMime,
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
  bodyDropFolderId,
  externalDrop,
}: UseFolderRowDragDropOptions): FolderRowDragDrop {
  const [activeDropTarget, setActiveDropTarget] = useState<ActiveDropTarget | null>(null)
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
    externalDrop,
  })
  optionsRef.current = {
    descendantsByFolderId,
    getFolderParentId,
    getResourceFolderId,
    getRowLabel,
    onMoveRows,
    selection,
    externalDrop,
  }

  const springNav = useSpringNavigation({ currentFolderId, onNavigate: onSpringOpenFolder })

  const currentFolderIdRef = useRef(currentFolderId)
  currentFolderIdRef.current = currentFolderId

  const bodyDropFolderIdRef = useRef(bodyDropFolderId)
  bodyDropFolderIdRef.current = bodyDropFolderId

  const dragGhost = useRowDragGhost()

  /** Returns the list to its resting state once a drag is over, however it ended. */
  const endDrag = useCallback(() => {
    springNav.end()
    dragGhost.remove()
    draggedRowIdsRef.current = []
    setDraggedRowIds(EMPTY_ROW_IDS)
    setActiveDropTarget(null)
  }, [dragGhost, springNav])

  useDragTeardown(endDrag)

  /**
   * Splits the drag into the rows that would actually move into `targetFolderId`, dropping any
   * row already sitting directly there and any row a dragged folder already carries (see
   * {@link dropRowsCarriedByDraggedFolders}). `null` when the drop is illegal outright — the
   * target is one of the dragged folders or inside one, which would orphan a subtree into
   * itself — or when nothing would actually change.
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

      const moved = dropRowsCarriedByDraggedFolders(
        { folderIds, resourceIds },
        { descendantsByFolderId, getFolderParentId, getResourceFolderId }
      )
      if (moved.folderIds.length === 0 && moved.resourceIds.length === 0) return null
      return moved
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

  return useMemo<FolderRowDragDrop>(
    () => ({
      activeDropTargetId: activeDropTarget?.kind === 'row' ? activeDropTarget.rowId : null,
      draggedRowIds,
      isAnyDragActive: draggedRowIds.size > 0,
      isRowDraggable: (rowId) => canEdit && editingRowId !== rowId,
      isRowDropTarget: (rowId) => canEdit && parseFolderedRowId(rowId).kind === 'folder',
      onDragStart: (e: DragEvent<HTMLDivElement>, rowId) => {
        if (!canEdit || editingRowId === rowId) {
          e.preventDefault()
          return
        }

        springNav.rememberOrigin()
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
        writeRowDragPayload(e.dataTransfer, dragMime, sourceRowIds)

        dragGhost.attach(e, optionsRef.current.getRowLabel(sourceRowIds[0]), sourceRowIds.length)
      },
      onDragOver: (e: DragEvent<HTMLDivElement>, rowId) => {
        const sourceRowIds = draggedRowIdsRef.current
        const isExternal = optionsRef.current.externalDrop?.matches(e.dataTransfer) ?? false
        if (isExternal) {
          /**
           * An upload into a nested folder is the same gesture as a move into one, so the row
           * highlights and springs open exactly the same way. Only the move-validity gate is
           * skipped — there are no source rows to validate.
           */
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
          setActiveDropTarget((current) => armDropTarget(current, { kind: 'row', rowId }))
          springNav.arm(parseFolderedRowId(rowId).id)
          return
        }
        if (sourceRowIds.length > 0) {
          if (!resolveMove(rowId, sourceRowIds)) return
        } else if (!e.dataTransfer.types.includes(dragMime)) {
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
          setActiveDropTarget((current) => armDropTarget(current, { kind: 'row', rowId }))
          /**
           * Armed on the same condition as the highlight, so a folder only springs open where a
           * drop was already possible. A folder the drag cannot legally enter never opens.
           */
          springNav.arm(parseFolderedRowId(rowId).id)
        }
      },
      onDragLeave: (e: DragEvent<HTMLDivElement>, rowId) => {
        const relatedTarget = e.relatedTarget
        if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) return
        springNav.disarm()
        setActiveDropTarget((current) =>
          current?.kind === 'row' && current.rowId === rowId ? null : current
        )
      },
      onDrop: (e: DragEvent<HTMLDivElement>, rowId) => {
        e.preventDefault()
        e.stopPropagation()

        const target = parseFolderedRowId(rowId)
        const { externalDrop } = optionsRef.current
        if (externalDrop?.matches(e.dataTransfer)) {
          const { dataTransfer } = e
          /**
           * Marked before `endDrag`, which consumes the flag: an upload lands in the folder the
           * drag opened, so the view has to stay there rather than springing back to the origin.
           */
          if (target.kind === 'folder') springNav.markDropHandled()
          endDrag()
          if (target.kind === 'folder') externalDrop.onDropIntoFolder(dataTransfer, target.id)
          return
        }
        // Prefer the dataTransfer payload over the ref so a drag that started in another
        // mount of this page still resolves to real row ids.
        const sourceRowIds =
          readRowDragPayload(e.dataTransfer, dragMime) ?? draggedRowIdsRef.current
        const move =
          target.kind === 'folder' && sourceRowIds.length > 0
            ? resolveMove(rowId, sourceRowIds)
            : null
        if (move) springNav.markDropHandled()

        /**
         * Ends the drag here rather than leaving it to `dragend`. This handler stops
         * propagation, so the window-level backstop never sees this drop, and the source row
         * may already have unmounted — after a spring-open it always has.
         */
        endDrag()

        if (move) optionsRef.current.onMoveRows(move, target.id)
      },
      onDragEnd: endDrag,
      externalDropHandled: springNav.markDropHandled,
      /**
       * The breadcrumb is how a drag walks back UP. Spring-loading only ever goes deeper, so
       * without this a drag that entered a folder can only leave it by being abandoned.
       * Hovering a crumb navigates to it on the same timer a folder row uses, and releasing on
       * one files the drag there directly.
       */
      breadcrumb: {
        activeIndex: activeDropTarget?.kind === 'crumb' ? activeDropTarget.index : null,
        onDragOver: (e: DragEvent<HTMLElement>, folderId: string | null, index: number) => {
          if (optionsRef.current.externalDrop?.matches(e.dataTransfer)) return
          const sourceRowIds = draggedRowIdsRef.current
          const canDrop =
            sourceRowIds.length > 0 && resolveMoveToFolder(folderId, sourceRowIds) !== null
          /**
           * Armed even when the drop itself would be a no-op — walking back through a crumb the
           * rows already live in is exactly how a user returns to where they started, and
           * refusing to navigate there would strand them. The crumb for the folder already on
           * screen is declined by {@link useSpringNavigation}, not here.
           */
          if (sourceRowIds.length > 0) springNav.arm(folderId)
          setActiveDropTarget((current) =>
            canDrop ? armDropTarget(current, { kind: 'crumb', index }) : null
          )
          if (!canDrop) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
        },
        onDragLeave: (_e: DragEvent<HTMLElement>, index: number) => {
          springNav.disarm()
          setActiveDropTarget((current) =>
            current?.kind === 'crumb' && current.index === index ? null : current
          )
        },
        onDrop: (e: DragEvent<HTMLElement>, folderId: string | null) => {
          if (optionsRef.current.externalDrop?.matches(e.dataTransfer)) return
          e.preventDefault()
          e.stopPropagation()
          const sourceRowIds =
            readRowDragPayload(e.dataTransfer, dragMime) ?? draggedRowIdsRef.current
          const move = sourceRowIds.length > 0 ? resolveMoveToFolder(folderId, sourceRowIds) : null
          if (move) springNav.markDropHandled()
          endDrag()
          if (move) optionsRef.current.onMoveRows(move, folderId)
        },
      },
      body: {
        isActive: activeDropTarget?.kind === 'body',
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          /** Declined: a page-level upload overlay owns the whole region for an OS file drag. */
          if (optionsRef.current.externalDrop?.matches(e.dataTransfer)) return
          const sourceRowIds = draggedRowIdsRef.current
          /**
           * Recomputed on every event rather than latched, because a spring-open changes the
           * destination mid-drag: the folder just entered may not accept this drag, and an
           * early return would leave the body overlay showing from the previous folder. Setting
           * the same value repeatedly is free — React bails on an unchanged state write.
           */
          const targetFolderId = bodyDropFolderIdRef.current
          const canDrop =
            targetFolderId !== undefined &&
            sourceRowIds.length > 0 &&
            resolveMoveToFolder(targetFolderId, sourceRowIds) !== null
          setActiveDropTarget((current) =>
            canDrop ? armDropTarget(current, { kind: 'body' }) : null
          )
          if (!canDrop) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        },
        onDragLeave: (e: DragEvent<HTMLDivElement>) => {
          const relatedTarget = e.relatedTarget
          if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) return
          setActiveDropTarget((current) => (current?.kind === 'body' ? null : current))
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          if (optionsRef.current.externalDrop?.matches(e.dataTransfer)) return
          /**
           * Read from the ref, not the closure. This config is memoized, and during a drag the
           * only dep that routinely changes is the hovered row — so after a spring-open into an
           * empty folder, which has no rows to hover, a captured folder id would still name
           * the folder the drag came FROM and file the rows back into it.
           */
          const targetFolderId = bodyDropFolderIdRef.current
          /** The body never armed, so a release here is a miss rather than a move. */
          if (targetFolderId === undefined) return
          e.preventDefault()
          e.stopPropagation()
          const sourceRowIds =
            readRowDragPayload(e.dataTransfer, dragMime) ?? draggedRowIdsRef.current
          const move =
            sourceRowIds.length > 0 ? resolveMoveToFolder(targetFolderId, sourceRowIds) : null
          if (move) springNav.markDropHandled()
          endDrag()
          if (move) optionsRef.current.onMoveRows(move, targetFolderId)
        },
      },
    }),
    [
      activeDropTarget,
      draggedRowIds,
      canEdit,
      dragMime,
      editingRowId,
      resolveMove,
      resolveMoveToFolder,
      springNav,
      endDrag,
      dragGhost,
    ]
  )
}
