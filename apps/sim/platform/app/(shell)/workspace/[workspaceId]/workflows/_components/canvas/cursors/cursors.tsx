'use client'

import { memo, useMemo } from 'react'
import { useViewport } from '@xyflow/react'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/cursors/cursors.module.css'
import {
  getUserColor,
  usePresenceStore,
  usePreventZoom,
  useSocket,
  useWorkflowRegistry,
} from '@/platform/lib/data/workflows'

interface CursorPoint {
  x: number
  y: number
}

interface CursorRenderData {
  id: string
  name: string
  cursor: CursorPoint
  color: string
}

const CursorsComponent = () => {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { currentWorkflowId, currentSocketId } = useSocket()
  const presenceUsers = usePresenceStore((state) => state.presenceUsers)
  const viewport = useViewport()
  const preventZoomRef = usePreventZoom()

  const cursors = useMemo<CursorRenderData[]>(() => {
    if (!activeWorkflowId || currentWorkflowId !== activeWorkflowId) {
      return []
    }

    return presenceUsers
      .filter((user): user is typeof user & { cursor: CursorPoint } => Boolean(user.cursor))
      .filter((user) => user.socketId !== currentSocketId)
      .map((user) => ({
        id: user.socketId,
        name: user.userName?.trim() || 'Collaborator',
        cursor: user.cursor,
        color: getUserColor(user.userId),
      }))
  }, [activeWorkflowId, currentSocketId, currentWorkflowId, presenceUsers])

  if (!cursors.length) {
    return null
  }

  return (
    <div ref={preventZoomRef} className={styles.layer}>
      {cursors.map(({ id, name, cursor, color }) => {
        const x = cursor.x * viewport.zoom + viewport.x
        const y = cursor.y * viewport.zoom + viewport.y

        return (
          <div
            key={id}
            className={styles.cursor}
            style={{
              transform: `translate3d(${x}px, ${y}px, 0)`,
              transition: 'transform 0.12s ease-out',
            }}
          >
            <div className={styles.pointer}>
              <svg
                className={styles.arrow}
                width={24}
                height={24}
                viewBox='0 0 24 24'
                fill={color}
                aria-hidden='true'
              >
                <path d='M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z' />
              </svg>
              <div className={styles.nameTag} style={{ backgroundColor: color }}>
                {name}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Collaborators' live cursors over the canvas, positioned in screen space from the viewport. */
export const Cursors = memo(CursorsComponent)
Cursors.displayName = 'Cursors'
