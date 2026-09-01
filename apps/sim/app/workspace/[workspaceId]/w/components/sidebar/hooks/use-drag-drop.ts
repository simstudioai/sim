import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { noop } from '@sim/utils/helpers'
import { useParams } from 'next/navigation'
import { getFolderPath } from '@/lib/folders/tree'
import { compareByOrder } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { useReorderFolders } from '@/hooks/queries/folders'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { useReorderWorkflows } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'

const logger = createLogger('WorkflowList:DragDrop')

const SCROLL_THRESHOLD = 60
const SCROLL_SPEED = 8
const HOVER_EXPAND_DELAY = 400

export interface DropIndicator {
  targetId: string
  position: 'before' | 'after' | 'inside'
  folderId: string | null
}

interface UseDragDropOptions {
  disabled?: boolean
}

type SiblingItem = {
  type: 'folder' | 'workflow'
  id: string
  sortOrder: number
  createdAt: Date
}

/** Stable no-op drop-zone handlers returned when drag-and-drop is disabled. */
const NOOP_DRAG_HANDLERS = {
  onDragOver: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
  onDrop: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
  onDragLeave: () => {},
}

const createNoopDragHandlers = () => NOOP_DRAG_HANDLERS

/** Root folder vs root workflow scope: API/cache may use null or undefined for "no parent". */
function isSameFolderScope(
  parentOrFolderId: string | null | undefined,
  scope: string | null
): boolean {
  return (parentOrFolderId ?? null) === (scope ?? null)
}

/**
 * A reorder that did not fully commit. Carries whether the failure was partial rather than a
 * ready-made sentence, so the copy is chosen where it is presented and raw transport errors from
 * the underlying requests never reach the user.
 */
class ReorderFailedError extends Error {
  readonly partial: boolean

  constructor(partial: boolean, causes: unknown[]) {
    super(partial ? 'Reorder partially failed' : 'Reorder failed', { cause: causes })
    this.name = 'ReorderFailedError'
    this.partial = partial
  }
}

/** The parts of a drag event this module needs, shared by React's synthetic event and the native one. */
type DragLeaveLike = Pick<DragEvent, 'relatedTarget' | 'clientX' | 'clientY'>

/**
 * Whether a drag has genuinely left `element`, rather than crossing one of its internal boundaries.
 *
 * `relatedTarget` alone cannot answer this. `dragleave` bubbles, so a listener sees one for every
 * descendant the pointer leaves, and Chrome reports `relatedTarget` as `null` on all of them
 * (Firefox populates it). Reading "no related node" as "left the element" therefore treated every
 * internal crossing as an exit — which cleared the drop indicator mid-drag, and `handleDrop` bails
 * on a null indicator, so releasing just after a crossing did nothing at all. Rows nested inside an
 * expanded folder cross the most boundaries, which is why it looked like open folders broke
 * dragging outright.
 *
 * The pointer position is the reliable signal on every engine, so it backs the null case.
 */
function hasDragLeftElement(element: HTMLElement, e: DragLeaveLike): boolean {
  const related = e.relatedTarget as Node | null
  if (related) return !element.contains(related)
  const rect = element.getBoundingClientRect()
  return !(
    e.clientX >= rect.left &&
    e.clientX <= rect.right &&
    e.clientY >= rect.top &&
    e.clientY <= rect.bottom
  )
}

/** Which half of a workflow row the pointer is in, deciding whether the drop line sits above or below. */
function calculateDropPosition(e: React.DragEvent, element: HTMLElement): 'before' | 'after' {
  const rect = element.getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  return e.clientY < midY ? 'before' : 'after'
}

/**
 * Folder rows take a third outcome: the middle band drops *into* the folder, while the outer
 * quarters reorder around it.
 */
function calculateFolderDropPosition(
  e: React.DragEvent,
  element: HTMLElement
): 'before' | 'inside' | 'after' {
  const rect = element.getBoundingClientRect()
  const relativeY = e.clientY - rect.top
  const height = rect.height
  if (relativeY < height * 0.25) return 'before'
  if (relativeY > height * 0.75) return 'after'
  return 'inside'
}

/** The folder a drop lands in: the target itself when dropping inside one, otherwise its scope. */
function getDestinationFolderId(indicator: DropIndicator): string | null {
  return indicator.position === 'inside'
    ? indicator.targetId === 'root'
      ? null
      : indicator.targetId
    : indicator.folderId
}

/**
 * Insert index into the list of siblings **excluding** moving items. Must use the full
 * `siblingItems` list for lookup: when the drop line targets the dragged row,
 * `indicator.targetId` is not present in `remaining`, so indexing `remaining` alone
 * returns -1 and corrupts the splice.
 */
function getInsertIndexInRemaining(
  siblingItems: SiblingItem[],
  movingIds: Set<string>,
  indicator: DropIndicator
): number {
  if (indicator.position === 'inside') {
    return siblingItems.filter((s) => !movingIds.has(s.id)).length
  }

  const targetIdx = siblingItems.findIndex((s) => s.id === indicator.targetId)
  if (targetIdx === -1) {
    return siblingItems.filter((s) => !movingIds.has(s.id)).length
  }

  if (indicator.position === 'before') {
    return siblingItems.slice(0, targetIdx).filter((s) => !movingIds.has(s.id)).length
  }

  return siblingItems.slice(0, targetIdx + 1).filter((s) => !movingIds.has(s.id)).length
}

/** Whether a drag has left the element the handler is bound to. See {@link hasDragLeftElement}. */
const isLeavingElement = (e: React.DragEvent<HTMLElement>): boolean =>
  hasDragLeftElement(e.currentTarget, e)

export function useDragDrop(options: UseDragDropOptions = {}) {
  const { disabled = false } = options
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  /**
   * Mirrors `dropIndicator` synchronously. `drop` can fire before React commits the last
   * `dragOver` state update, so `handleDrop` must read this ref instead of state.
   */
  const dropIndicatorRef = useRef<DropIndicator | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollAnimationRef = useRef<number | null>(null)
  const hoverExpandTimerRef = useRef<number | null>(null)
  const lastDragYRef = useRef<number>(0)
  const draggedSourceFolderRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  /**
   * Folders this drag spring-opened, so {@link handleDragEnd} can close the ones the drop did not
   * land in. Only ever holds folders that were collapsed when the drag reached them, so a folder
   * the user opened themselves is never touched.
   */
  const autoExpandedRef = useRef<Set<string> | null>(null)

  const params = useParams()
  const workspaceId = params.workspaceId as string | undefined

  /**
   * Destructured because the mutation objects take a new identity on every state transition, so
   * depending on them would re-create this hook's handler factories mid-drop and hand every sidebar
   * row a fresh handler object. `mutateAsync` is stable in TanStack Query v5.
   */
  const { mutateAsync: reorderWorkflows } = useReorderWorkflows()
  const { mutateAsync: reorderFolders } = useReorderFolders()
  const setExpanded = useFolderStore((s) => s.setExpanded)
  const expandedFolders = useFolderStore((s) => s.expandedFolders)

  const handleAutoScroll = useCallback(() => {
    if (!scrollContainerRef.current) {
      scrollAnimationRef.current = null
      return
    }

    const container = scrollContainerRef.current
    const rect = container.getBoundingClientRect()
    const mouseY = lastDragYRef.current

    if (mouseY < rect.top || mouseY > rect.bottom) {
      scrollAnimationRef.current = requestAnimationFrame(handleAutoScroll)
      return
    }

    const distanceFromTop = mouseY - rect.top
    const distanceFromBottom = rect.bottom - mouseY

    let scrollDelta = 0

    if (distanceFromTop < SCROLL_THRESHOLD && container.scrollTop > 0) {
      const intensity = Math.max(0, Math.min(1, 1 - distanceFromTop / SCROLL_THRESHOLD))
      scrollDelta = -SCROLL_SPEED * intensity
    } else if (distanceFromBottom < SCROLL_THRESHOLD) {
      const maxScroll = container.scrollHeight - container.clientHeight
      if (container.scrollTop < maxScroll) {
        const intensity = Math.max(0, Math.min(1, 1 - distanceFromBottom / SCROLL_THRESHOLD))
        scrollDelta = SCROLL_SPEED * intensity
      }
    }

    if (scrollDelta !== 0) {
      container.scrollTop += scrollDelta
    }

    scrollAnimationRef.current = requestAnimationFrame(handleAutoScroll)
  }, [])

  useEffect(() => {
    if (isDragging) {
      scrollAnimationRef.current = requestAnimationFrame(handleAutoScroll)
    } else if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current)
      scrollAnimationRef.current = null
    }

    return () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current)
        scrollAnimationRef.current = null
      }
    }
  }, [isDragging, handleAutoScroll])

  useEffect(() => {
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current)
      hoverExpandTimerRef.current = null
    }

    if (!isDragging || !hoverFolderId) return
    if (expandedFolders.has(hoverFolderId)) return

    hoverExpandTimerRef.current = window.setTimeout(() => {
      autoExpandedRef.current ??= new Set()
      autoExpandedRef.current.add(hoverFolderId)
      setExpanded(hoverFolderId, true)
    }, HOVER_EXPAND_DELAY)

    return () => {
      if (hoverExpandTimerRef.current) {
        clearTimeout(hoverExpandTimerRef.current)
        hoverExpandTimerRef.current = null
      }
    }
  }, [hoverFolderId, isDragging, expandedFolders, setExpanded])

  const buildAndSubmitUpdates = useCallback(
    async (
      targetWorkspaceId: string,
      newOrder: SiblingItem[],
      destinationFolderId: string | null
    ) => {
      const indexed = newOrder.map((item, i) => ({ ...item, sortOrder: i }))

      const folderUpdates = indexed
        .filter((item) => item.type === 'folder')
        .map((item) => ({ id: item.id, sortOrder: item.sortOrder, parentId: destinationFolderId }))

      const workflowUpdates = indexed
        .filter((item) => item.type === 'workflow')
        .map((item) => ({ id: item.id, sortOrder: item.sortOrder, folderId: destinationFolderId }))

      /**
       * Folders and workflows share one index space but commit through separate endpoints, so a
       * drop that moves both issues two requests. `allSettled` rather than `all`: with `all`, one
       * rejection abandons the other request while it is still in flight and commits anyway,
       * leaving the caller unable to tell a total failure from a half-applied one.
       */
      const pending: Promise<unknown>[] = []
      if (folderUpdates.length > 0) {
        pending.push(
          reorderFolders({
            workspaceId: targetWorkspaceId,
            updates: folderUpdates,
          })
        )
      }
      if (workflowUpdates.length > 0) {
        pending.push(
          reorderWorkflows({
            workspaceId: targetWorkspaceId,
            updates: workflowUpdates,
          })
        )
      }

      const results = await Promise.allSettled(pending)
      const rejected = results.filter((result) => result.status === 'rejected')
      if (rejected.length === 0) return

      /**
       * Whether the failure was partial only selects the message. Convergence needs nothing here:
       * each mutation's own `onSettled` invalidates its list on error as well as success, so the
       * committed side and the rolled-back side both refetch to server truth on their own.
       */
      throw new ReorderFailedError(
        rejected.length < results.length,
        rejected.map((result) => result.reason)
      )
    },
    [reorderFolders, reorderWorkflows]
  )

  const initDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>, stopPropagation = true): boolean => {
      e.preventDefault()
      if (stopPropagation) e.stopPropagation()
      lastDragYRef.current = e.clientY

      /**
       * Read from the ref, not the `isDragging` state: several `dragover` events fire before React
       * commits the first `setIsDragging`, and on those frames the state still reads false while
       * the drag is already live — which would skip restarting the auto-scroll loop below.
       */
      if (!isDraggingRef.current) {
        isDraggingRef.current = true
        setIsDragging(true)
      } else if (scrollAnimationRef.current === null) {
        scrollAnimationRef.current = requestAnimationFrame(handleAutoScroll)
      }

      return true
    },
    [handleAutoScroll]
  )

  /**
   * Siblings in one folder scope, read live from the query cache on every call. Deliberately
   * uncached: the only callers are the drag-over indicator and the drop itself, and both must see
   * the optimistic order the previous drop already wrote.
   */
  const getSiblingItems = useCallback(
    (folderId: string | null): SiblingItem[] => {
      const currentFolders = workspaceId ? getFolderMap(workspaceId) : {}
      const currentWorkflows = workspaceId ? getWorkflows(workspaceId) : []
      const siblings = [
        ...Object.values(currentFolders)
          .filter((f) => isSameFolderScope(f.parentId, folderId))
          .map((f) => ({
            type: 'folder' as const,
            id: f.id,
            sortOrder: f.sortOrder,
            createdAt: f.createdAt,
          })),
        ...currentWorkflows
          .filter((w) => isSameFolderScope(w.folderId, folderId))
          .map((w) => ({
            type: 'workflow' as const,
            id: w.id,
            sortOrder: w.sortOrder,
            createdAt: w.createdAt,
          })),
      ].sort(compareByOrder)

      return siblings
    },
    [workspaceId]
  )

  const setNormalizedDropIndicator = useCallback(
    (indicator: DropIndicator | null) => {
      if (indicator === null) {
        dropIndicatorRef.current = null
        setDropIndicator(null)
        return
      }

      let next: DropIndicator = indicator
      if (indicator.position === 'after' && indicator.targetId !== 'root') {
        const siblings = getSiblingItems(indicator.folderId)
        const currentIdx = siblings.findIndex((s) => s.id === indicator.targetId)
        if (currentIdx !== -1) {
          const nextSibling = siblings[currentIdx + 1]
          if (nextSibling) {
            next = {
              targetId: nextSibling.id,
              position: 'before',
              folderId: indicator.folderId,
            }
          }
        }
      }

      setDropIndicator((prev) => {
        if (
          prev?.targetId === next.targetId &&
          prev?.position === next.position &&
          prev?.folderId === next.folderId
        ) {
          dropIndicatorRef.current = prev
          return prev
        }
        dropIndicatorRef.current = next
        return next
      })
    },
    [getSiblingItems]
  )

  const canMoveFolderTo = useCallback(
    (folderId: string, destinationFolderId: string | null): boolean => {
      if (folderId === destinationFolderId) return false
      if (!destinationFolderId) return true
      if (!workspaceId) return false
      const targetPath = getFolderPath(getFolderMap(workspaceId), destinationFolderId)
      return !targetPath.some((f) => f.id === folderId)
    },
    [workspaceId]
  )

  const collectMovingItems = useCallback(
    (
      workflowIds: string[],
      folderIds: string[],
      destinationFolderId: string | null
    ): { fromDestination: SiblingItem[]; fromOther: SiblingItem[] } => {
      const folders = workspaceId ? getFolderMap(workspaceId) : {}
      const workflows = workspaceId ? getWorkflows(workspaceId) : []

      const fromDestination: SiblingItem[] = []
      const fromOther: SiblingItem[] = []

      for (const id of workflowIds) {
        const workflow = workflows.find((w) => w.id === id)
        if (!workflow) continue
        const item: SiblingItem = {
          type: 'workflow',
          id,
          sortOrder: workflow.sortOrder,
          createdAt: workflow.createdAt,
        }
        if (isSameFolderScope(workflow.folderId, destinationFolderId)) {
          fromDestination.push(item)
        } else {
          fromOther.push(item)
        }
      }

      for (const id of folderIds) {
        const folder = folders[id]
        if (!folder) continue
        const item: SiblingItem = {
          type: 'folder',
          id,
          sortOrder: folder.sortOrder,
          createdAt: folder.createdAt,
        }
        if (isSameFolderScope(folder.parentId, destinationFolderId)) {
          fromDestination.push(item)
        } else {
          fromOther.push(item)
        }
      }

      fromDestination.sort(compareByOrder)
      fromOther.sort(compareByOrder)

      return { fromDestination, fromOther }
    },
    [workspaceId]
  )

  const handleSelectionDrop = useCallback(
    async (selection: { workflowIds: string[]; folderIds: string[] }, indicator: DropIndicator) => {
      if (!workspaceId) return

      const { workflowIds, folderIds } = selection
      if (workflowIds.length === 0 && folderIds.length === 0) return

      try {
        const destinationFolderId = getDestinationFolderId(indicator)
        const validFolderIds = folderIds.filter((id) => canMoveFolderTo(id, destinationFolderId))
        if (workflowIds.length === 0 && validFolderIds.length === 0) {
          return
        }

        const siblingItems = getSiblingItems(destinationFolderId)
        const movingIds = new Set([...workflowIds, ...validFolderIds])
        const remaining = siblingItems.filter((item) => !movingIds.has(item.id))

        const { fromDestination, fromOther } = collectMovingItems(
          workflowIds,
          validFolderIds,
          destinationFolderId
        )

        const insertAt = getInsertIndexInRemaining(siblingItems, movingIds, indicator)
        const newOrder = [
          ...remaining.slice(0, insertAt),
          ...fromDestination,
          ...fromOther,
          ...remaining.slice(insertAt),
        ]

        await buildAndSubmitUpdates(workspaceId, newOrder, destinationFolderId)

        const { clearSelection, clearFolderSelection } = useFolderStore.getState()
        clearSelection()
        clearFolderSelection()
      } catch (error) {
        logger.error('Failed to drop selection:', error)
        /**
         * Each mutation rolls its own slice of the cache back, so a failure is otherwise visible
         * only as the rows silently returning to where they were — which reads as the sidebar
         * spontaneously undoing the move. Copy is chosen here rather than carried on the error so
         * transport-level text never reaches the user.
         */
        toast.error(
          error instanceof ReorderFailedError && error.partial
            ? 'Only some items moved'
            : 'Failed to move items'
        )
      }
    },
    [
      workspaceId,
      getDestinationFolderId,
      canMoveFolderTo,
      getSiblingItems,
      collectMovingItems,
      getInsertIndexInRemaining,
      buildAndSubmitUpdates,
    ]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const indicator = dropIndicatorRef.current
      dropIndicatorRef.current = null
      setDropIndicator(null)
      isDraggingRef.current = false
      setIsDragging(false)
      /**
       * The destination and its ancestors stop being candidates for the drag-end collapse, so the
       * folders holding the moved rows stay open. Done synchronously, before any `await`, because
       * `dragend` fires as soon as this handler yields. Discarding ids rather than recording one to
       * keep also means a destination missing from the folder map simply survives untouched.
       */
      const destination = indicator ? getDestinationFolderId(indicator) : null
      const autoExpanded = autoExpandedRef.current
      if (destination && autoExpanded?.size) {
        autoExpanded.delete(destination)
        if (workspaceId) {
          for (const folder of getFolderPath(getFolderMap(workspaceId), destination)) {
            autoExpanded.delete(folder.id)
          }
        }
      }

      if (!indicator) return

      try {
        const selectionData = e.dataTransfer.getData('sidebar-selection')
        if (!selectionData) return

        const selection = JSON.parse(selectionData) as {
          workflowIds: string[]
          folderIds: string[]
        }
        await handleSelectionDrop(selection, indicator)
      } catch (error) {
        logger.error('Failed to handle drop:', error)
      }
    },
    [handleSelectionDrop, workspaceId]
  )

  const createWorkflowDragHandlers = useCallback(
    (workflowId: string, folderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        const isSameFolder = draggedSourceFolderRef.current === folderId
        if (isSameFolder) {
          const position = calculateDropPosition(e, e.currentTarget)
          setNormalizedDropIndicator({ targetId: workflowId, position, folderId })
        } else {
          setNormalizedDropIndicator({
            targetId: folderId || 'root',
            position: 'inside',
            folderId: null,
          })
        }
      },
      onDragLeave: () => {},
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, handleDrop]
  )

  const createFolderDragHandlers = useCallback(
    (folderId: string, parentFolderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        const isSameParent = draggedSourceFolderRef.current === parentFolderId
        if (isSameParent) {
          const position = calculateFolderDropPosition(e, e.currentTarget)
          setNormalizedDropIndicator({ targetId: folderId, position, folderId: parentFolderId })
          if (position === 'inside') {
            setHoverFolderId(folderId)
          } else {
            setHoverFolderId(null)
          }
        } else {
          setNormalizedDropIndicator({
            targetId: folderId,
            position: 'inside',
            folderId: parentFolderId,
          })
          setHoverFolderId(folderId)
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setHoverFolderId(null)
      },
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, handleDrop]
  )

  const createEmptyFolderDropZone = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        setNormalizedDropIndicator({ targetId: folderId, position: 'inside', folderId })
      },
      onDragLeave: () => {},
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, handleDrop]
  )

  const createFolderContentDropZone = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        if (e.target === e.currentTarget && draggedSourceFolderRef.current !== folderId) {
          setNormalizedDropIndicator({ targetId: folderId, position: 'inside', folderId: null })
        }
      },
      onDragLeave: () => {},
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, handleDrop]
  )

  const createRootDropZone = useCallback(
    () => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e, false)) return
        if (e.target === e.currentTarget) {
          setNormalizedDropIndicator({ targetId: 'root', position: 'inside', folderId: null })
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setNormalizedDropIndicator(null)
      },
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, handleDrop]
  )

  const createEdgeDropZone = useCallback(
    (itemId: string | null, position: 'before' | 'after') => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        if (itemId) {
          const edge: DropIndicator = { targetId: itemId, position, folderId: null }
          dropIndicatorRef.current = edge
          setDropIndicator(edge)
        } else {
          setNormalizedDropIndicator({ targetId: 'root', position: 'inside', folderId: null })
        }
      },
      onDragLeave: () => {},
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, handleDrop]
  )

  const handleDragStart = useCallback((sourceFolderId: string | null) => {
    draggedSourceFolderRef.current = sourceFolderId
    isDraggingRef.current = true
    setIsDragging(true)
  }, [])

  /**
   * Closes the folders this drag spring-opened, keeping the drop destination and its ancestors
   * open so the moved rows stay visible. Runs on every drag end — drop, Esc-cancel, or a release
   * outside the list — because `dragend` always fires on the source, so a cancelled drag cannot
   * leave folders open that the user never chose to open.
   */
  const collapseAutoExpandedFolders = useCallback(() => {
    const autoExpanded = autoExpandedRef.current
    if (!autoExpanded?.size) return
    for (const folderId of autoExpanded) setExpanded(folderId, false)
    autoExpanded.clear()
  }, [setExpanded])

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    setIsDragging(false)
    dropIndicatorRef.current = null
    setDropIndicator(null)
    draggedSourceFolderRef.current = null
    setHoverFolderId(null)
    /**
     * Disarmed here rather than left to the effect cleanup, which only runs once React commits the
     * state changes above. A timer due within that gap would otherwise fire after the collapse
     * below, spring-opening a folder for a drag that already ended and leaving it in the set for
     * the next drag to close — a folder the user, by then, opened themselves.
     */
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current)
      hoverExpandTimerRef.current = null
    }
    collapseAutoExpandedFolders()
  }, [collapseAutoExpandedFolders])

  useEffect(() => {
    if (!isDragging) return
    const container = scrollContainerRef.current
    if (!container) return
    const onLeave = (e: DragEvent) => {
      if (!hasDragLeftElement(container, e)) return
      if (scrollAnimationRef.current !== null) {
        cancelAnimationFrame(scrollAnimationRef.current)
        scrollAnimationRef.current = null
      }
      dropIndicatorRef.current = null
      setDropIndicator(null)
      setHoverFolderId(null)
    }
    const onWindowDrop = (e: DragEvent) => {
      const target = e.target as Node | null
      if (target && container.contains(target)) return
      handleDragEnd()
    }
    /**
     * `dragend` always fires on the drag source at the end of any drag operation, including
     * Esc-cancels and drops on non-droppable targets. Without this reset, a non-sidebar drag
     * that entered the list (flipping `isDragging` on via `initDragOver`) but ended without a
     * `drop` inside the container would strand `isDragging` at `true` — leaving the absolutely
     * positioned edge drop zones mounted over the first/last rows and stealing their grab band.
     */
    const onWindowDragEnd = () => handleDragEnd()
    container.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onWindowDrop, true)
    window.addEventListener('dragend', onWindowDragEnd, true)
    return () => {
      container.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('dragend', onWindowDragEnd, true)
    }
  }, [isDragging, handleDragEnd])

  const setScrollContainer = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element
  }, [])

  if (disabled) {
    return {
      dropIndicator: null,
      isDragging: false,
      disabled: true,
      setScrollContainer,
      createWorkflowDragHandlers: createNoopDragHandlers,
      createFolderDragHandlers: createNoopDragHandlers,
      createEmptyFolderDropZone: createNoopDragHandlers,
      createFolderContentDropZone: createNoopDragHandlers,
      createRootDropZone: createNoopDragHandlers,
      createEdgeDropZone: createNoopDragHandlers,
      handleDragStart: noop,
      handleDragEnd: noop,
    }
  }

  return {
    dropIndicator,
    isDragging,
    disabled: false,
    setScrollContainer,
    createWorkflowDragHandlers,
    createFolderDragHandlers,
    createEmptyFolderDropZone,
    createFolderContentDropZone,
    createRootDropZone,
    createEdgeDropZone,
    handleDragStart,
    handleDragEnd,
  }
}
