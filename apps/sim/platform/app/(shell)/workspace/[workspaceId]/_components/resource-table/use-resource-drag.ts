'use client'

import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  folderRowId,
  parseRowId,
  splitRowIds,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/folder-tree'
import type { ResourceSelection } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/use-resource-selection'

/**
 * How long a drag rests on a folder before it opens. Slower than a sidebar's expand: this one
 * moves the whole list out from under the drag, which a drag merely crossing a folder must not do.
 */
const SPRING_DELAY_MS = 1000

const NONE: ReadonlySet<string> = new Set()

type History = { history: 'push' | 'replace' }
type Target = { kind: 'row'; rowId: string } | { kind: 'body' } | null

/** The rows one drag moves, split by kind. */
export interface RowMove {
  folderIds: string[]
  resourceIds: string[]
}

interface UseResourceDragOptions {
  /** This list's private drag type, so a drag from another list is never read as one of these rows. */
  mime: string
  /** Moving is an edit; a reader drags nothing and nothing accepts a drop. */
  enabled: boolean
  /** The row being renamed stays editable rather than draggable. */
  renamingId?: string | null
  /** A row this returns false for stays put, as a locked workflow or folder does. */
  canDrag?: (rowId: string) => boolean
  /** Rows in display order, and the selection a dragged selected row carries with it. */
  rowIds: readonly string[]
  selection?: ResourceSelection
  /** The folder a row sits in now, for rejecting a move that changes nothing. */
  parentOf: (rowId: string) => string | null | undefined
  /** Every folder's descendants, so a folder never lands inside itself. */
  descendants: ReadonlyMap<string, ReadonlySet<string>>
  /** The row's name, shown under the pointer while dragging. */
  labelOf: (rowId: string) => string
  /** Moves the rows into `folderId` (`null` is the root) in one call. */
  onMove: (rows: RowMove, folderId: string | null) => void
  /** The folder the list shows. */
  currentFolderId: string | null
  /**
   * The folder a drop on the list's background files into, or `undefined` when the background
   * stands for no folder, as while searching, when the rows come from everywhere.
   */
  bodyFolderId: string | null | undefined
  /** Opens a folder the drag rested on, and returns to where the drag began if nothing landed. */
  onNavigate: (folderId: string | null, options: History) => void
  /** Files dragged in from the desktop: folder rows take them, the page's own overlay takes the rest. */
  external?: {
    matches: (data: DataTransfer) => boolean
    onDropIntoFolder: (data: DataTransfer, folderId: string) => void
  }
}

function writePayload(data: DataTransfer, mime: string, rowIds: readonly string[]) {
  data.setData(mime, JSON.stringify(rowIds))
  data.setData('text/plain', rowIds.join(','))
}

function readPayload(data: DataTransfer, mime: string): string[] | null {
  const raw = data.getData(mime)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return ids.length ? ids : null
  } catch {
    return null
  }
}

/**
 * Dragging rows onto folder rows, the list's background or a breadcrumb crumb to move them.
 * Resting on a folder or a crumb for a second opens it, so a row files into a nested folder in one
 * gesture; a drag that ends without landing returns to the folder it began in.
 */
export function useResourceDrag(options: UseResourceDragOptions) {
  const live = useRef(options)
  live.current = options
  const [dragged, setDragged] = useState<ReadonlySet<string>>(NONE)
  const [target, setTarget] = useState<Target>(null)
  const sourceIds = useRef<readonly string[]>([])
  const ghost = useRef<HTMLDivElement | null>(null)

  const spring = useRef({
    timer: null as ReturnType<typeof setTimeout> | null,
    armed: undefined as string | null | undefined,
    element: null as Element | null,
    opened: false,
    origin: null as string | null,
    hasOrigin: false,
    landed: false,
  })

  const disarm = useCallback(() => {
    const state = spring.current
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    state.armed = undefined
    state.element = null
  }, [])

  const arm = useCallback(
    (folderId: string | null, element: Element) => {
      const state = spring.current
      if (folderId === live.current.currentFolderId) {
        disarm()
        return
      }
      if (!state.hasOrigin) {
        state.origin = live.current.currentFolderId
        state.hasOrigin = true
      }
      state.element = element
      if (state.armed === folderId) return
      if (state.timer) clearTimeout(state.timer)
      state.armed = folderId
      state.timer = setTimeout(() => {
        state.timer = null
        state.armed = undefined
        state.element = null
        const first = !state.opened
        state.opened = true
        live.current.onNavigate(folderId, { history: first ? 'push' : 'replace' })
      }, SPRING_DELAY_MS)
    },
    [disarm]
  )

  const end = useCallback(() => {
    const state = spring.current
    disarm()
    if (
      state.opened &&
      !state.landed &&
      state.hasOrigin &&
      state.origin !== live.current.currentFolderId
    )
      live.current.onNavigate(state.origin, { history: 'replace' })
    state.opened = false
    state.landed = false
    state.hasOrigin = false
    sourceIds.current = []
    setDragged(NONE)
    setTarget(null)
  }, [disarm])

  // `dragend` fires at the source row, which a spring-open has already unmounted; the first pointer
  // move after a native drag is the one signal that always arrives.
  useEffect(() => {
    let dragging = false
    const over = (event: globalThis.DragEvent) => {
      dragging = true
      const element = spring.current.element
      if (element && !(event.target instanceof Node && element.contains(event.target))) disarm()
    }
    const finish = () => {
      if (!dragging) return
      dragging = false
      end()
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragend', finish)
    window.addEventListener('drop', finish)
    window.addEventListener('pointermove', finish)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragend', finish)
      window.removeEventListener('drop', finish)
      window.removeEventListener('pointermove', finish)
      disarm()
    }
  }, [disarm, end])

  /**
   * The rows that would actually move into `folderId`: a row already there drops out, and so does
   * a row a dragged folder carries. `null` when the move is illegal (a folder into its own subtree)
   * or would change nothing.
   */
  const resolve = useCallback((folderId: string | null, rowIds: readonly string[]) => {
    const { parentOf, descendants } = live.current
    const { folderIds, resourceIds } = splitRowIds(rowIds)
    const dragging = new Set(folderIds)
    for (const id of folderIds) {
      if (id === folderId) return null
      if (folderId !== null && descendants.get(id)?.has(folderId)) return null
    }
    const carried = (owner: string | null | undefined) => {
      if (!owner) return false
      for (const id of dragging) if (owner === id || descendants.get(id)?.has(owner)) return true
      return false
    }
    const move: RowMove = {
      folderIds: folderIds.filter((id) => {
        const parent = parentOf(folderRowId(id)) ?? null
        return parent !== folderId && !carried(parent)
      }),
      resourceIds: resourceIds.filter((id) => {
        const parent = parentOf(id) ?? null
        return parent !== folderId && !carried(parent)
      }),
    }
    return move.folderIds.length || move.resourceIds.length ? move : null
  }, [])

  const land = useCallback(
    (event: DragEvent<HTMLElement>, folderId: string | null) => {
      const ids = readPayload(event.dataTransfer, live.current.mime) ?? sourceIds.current
      const move = ids.length ? resolve(folderId, ids) : null
      if (move) spring.current.landed = true
      end()
      if (move) live.current.onMove(move, folderId)
    },
    [end, resolve]
  )

  const row = useCallback(
    (rowId: string) => {
      const { enabled, renamingId, canDrag, external, mime } = live.current
      const folderId = parseRowId(rowId).kind === 'folder' ? parseRowId(rowId).id : null
      const movable = enabled && renamingId !== rowId && (canDrag?.(rowId) ?? true)
      return {
        draggable: movable,
        onDragStart: (event: DragEvent<HTMLElement>) => {
          if (!movable) {
            event.preventDefault()
            return
          }
          const { selection, rowIds, labelOf, currentFolderId } = live.current
          spring.current.origin = currentFolderId
          spring.current.hasOrigin = true
          const ids = selection?.selected.has(rowId)
            ? rowIds.filter((id) => selection.selected.has(id))
            : [rowId]
          if (selection && !selection.selected.has(rowId)) selection.replace([rowId])
          sourceIds.current = ids
          setDragged(new Set(ids))
          event.dataTransfer.effectAllowed = 'move'
          writePayload(event.dataTransfer, mime, ids)
          const node = ghost.current
          if (node) {
            const label = labelOf(ids[0])
            node.textContent = ids.length > 1 ? `${label} +${ids.length - 1} more` : label
            event.dataTransfer.setDragImage(node, node.offsetWidth / 2, node.offsetHeight / 2)
          }
        },
        onDragEnd: end,
        ...(folderId !== null && enabled
          ? {
              onDragOver: (event: DragEvent<HTMLElement>) => {
                if (external?.matches(event.dataTransfer)) {
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'copy'
                  setTarget((current) =>
                    current?.kind === 'row' && current.rowId === rowId
                      ? current
                      : { kind: 'row', rowId }
                  )
                  arm(folderId, event.currentTarget)
                  return
                }
                const ids = sourceIds.current
                if (ids.length) {
                  if (!resolve(folderId, ids)) return
                } else if (!event.dataTransfer.types.includes(mime)) return
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
                if (!ids.length) return
                setTarget((current) =>
                  current?.kind === 'row' && current.rowId === rowId
                    ? current
                    : { kind: 'row', rowId }
                )
                arm(folderId, event.currentTarget)
              },
              onDragLeave: (event: DragEvent<HTMLElement>) => {
                const next = event.relatedTarget
                if (next instanceof Node && event.currentTarget.contains(next)) return
                disarm()
                setTarget((current) =>
                  current?.kind === 'row' && current.rowId === rowId ? null : current
                )
              },
              onDrop: (event: DragEvent<HTMLElement>) => {
                event.preventDefault()
                event.stopPropagation()
                if (external?.matches(event.dataTransfer)) {
                  spring.current.landed = true
                  const data = event.dataTransfer
                  end()
                  external.onDropIntoFolder(data, folderId)
                  return
                }
                land(event, folderId)
              },
            }
          : {}),
      }
    },
    [arm, disarm, end, land, resolve]
  )

  const body = useMemo(
    () => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const { external, bodyFolderId, enabled } = live.current
        if (!enabled || external?.matches(event.dataTransfer)) return
        const ids = sourceIds.current
        const droppable =
          bodyFolderId !== undefined && ids.length > 0 && resolve(bodyFolderId, ids) !== null
        setTarget((current) =>
          droppable ? (current?.kind === 'body' ? current : { kind: 'body' }) : null
        )
        if (!droppable) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setTarget((current) => (current?.kind === 'body' ? null : current))
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const { external, bodyFolderId } = live.current
        if (external?.matches(event.dataTransfer) || bodyFolderId === undefined) return
        event.preventDefault()
        event.stopPropagation()
        land(event, bodyFolderId)
      },
    }),
    [land, resolve]
  )

  /** A breadcrumb crumb's drop target: resting on it walks the drag back up the path. */
  const crumb = useCallback(
    (folderId: string | null) =>
      live.current.enabled
        ? {
            accepts: (event: DragEvent<HTMLElement>) => {
              if (live.current.external?.matches(event.dataTransfer)) return false
              const ids = sourceIds.current
              if (ids.length) arm(folderId, event.currentTarget)
              return ids.length > 0 && resolve(folderId, ids) !== null
            },
            onDrop: (event: DragEvent<HTMLElement>) => {
              event.stopPropagation()
              land(event, folderId)
            },
          }
        : undefined,
    [arm, land, resolve]
  )

  /** A page-level drop (an upload) landed where the drag opened, so the drag stays there. */
  const externalHandled = useCallback(() => {
    spring.current.landed = true
  }, [])

  return {
    dragged,
    /** The folder row a release would move the drag into. */
    targetId: target?.kind === 'row' ? target.rowId : null,
    bodyActive: target?.kind === 'body',
    row,
    body,
    crumb,
    externalHandled,
    ghost,
  }
}

/** The list's drag and drop, from `useResourceDrag`. */
export type ResourceDrag = ReturnType<typeof useResourceDrag>
