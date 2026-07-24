'use client'

import { type RefObject, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getUserColor } from '@/lib/workspaces/colors'
import type { ResourceTableHandle } from '@/app/workspace/[workspaceId]/components'
import { RemoteCursor } from '@/app/workspace/[workspaceId]/components/presence/remote-cursor'
import type { FilesCursor } from '@/app/workspace/[workspaceId]/files/hooks/use-workspace-files-room'

interface FilesCursorsProps {
  /** Imperative handle of the Resource table, exposing the scroll element. */
  tableApiRef: RefObject<ResourceTableHandle | null>
  /** Remote cursors in content-space coordinates (already folder-scoped, self excluded). */
  cursors: FilesCursor[]
  /** Emit the local pointer in content-space; `null` when it leaves the list. */
  emitCursor: (cursor: { x: number; y: number } | null) => void
}

/**
 * Collaborator cursors over the file list. Emits the local pointer in the list's
 * content-space (viewport-relative + scroll offset) and renders each remote cursor
 * back at `content − scroll`, so cursors stay anchored to content when either user
 * scrolls. Rendered via a portal in fixed/viewport space (matching the header's
 * veil) and clipped to the list's visible rect, so it survives any transformed
 * ancestor and never spills outside the panel. The mark itself is the shared
 * {@link RemoteCursor}, identical to the canvas.
 */
export function FilesCursors({ tableApiRef, cursors, emitCursor }: FilesCursorsProps) {
  const [mounted, setMounted] = useState(false)
  // Bumped on scroll/resize so the render re-reads scroll offset and repositions.
  const [, setViewportTick] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const el = tableApiRef.current?.getScrollElement()
    if (!el) return

    const handleMove = (event: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      emitCursor({
        x: event.clientX - rect.left + el.scrollLeft,
        y: event.clientY - rect.top + el.scrollTop,
      })
    }
    const handleLeave = () => emitCursor(null)
    const reposition = () => setViewportTick((tick) => tick + 1)

    el.addEventListener('mousemove', handleMove)
    el.addEventListener('mouseleave', handleLeave)
    el.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)

    return () => {
      el.removeEventListener('mousemove', handleMove)
      el.removeEventListener('mouseleave', handleLeave)
      el.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
      emitCursor(null)
    }
  }, [tableApiRef, emitCursor])

  const el = tableApiRef.current?.getScrollElement()
  if (!mounted || !el || cursors.length === 0) return null

  const rect = el.getBoundingClientRect()

  return createPortal(
    cursors.map((collaborator) => {
      const viewportX = rect.left + (collaborator.cursor.x - el.scrollLeft)
      const viewportY = rect.top + (collaborator.cursor.y - el.scrollTop)
      // Clip to the list's visible bounds so a cursor scrolled out of view (or in
      // another pane) is not drawn floating over the rest of the app.
      if (
        viewportX < rect.left ||
        viewportX > rect.right ||
        viewportY < rect.top ||
        viewportY > rect.bottom
      ) {
        return null
      }
      return (
        <div
          key={collaborator.socketId}
          className='pointer-events-none fixed top-0 left-0 z-20 select-none'
          style={{
            transform: `translate3d(${viewportX}px, ${viewportY}px, 0)`,
            transition: 'transform 0.1s ease-out',
          }}
        >
          <RemoteCursor
            name={collaborator.userName?.trim() || 'Collaborator'}
            color={getUserColor(collaborator.userId)}
          />
        </div>
      )
    }),
    document.body
  )
}
