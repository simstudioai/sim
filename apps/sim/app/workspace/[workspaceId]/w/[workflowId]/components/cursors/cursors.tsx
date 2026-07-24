'use client'

import { memo, useMemo } from 'react'
import { useViewport } from 'reactflow'
import { getUserColor } from '@/lib/workspaces/colors'
import { RemoteCursor } from '@/app/workspace/[workspaceId]/components/presence/remote-cursor'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { usePresenceStore } from '@/stores/presence/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
    <div
      ref={preventZoomRef}
      className='pointer-events-none absolute inset-0 z-[5] select-none overflow-hidden'
    >
      {cursors.map(({ id, name, cursor, color }) => {
        const x = cursor.x * viewport.zoom + viewport.x
        const y = cursor.y * viewport.zoom + viewport.y

        return (
          <div
            key={id}
            className='pointer-events-none absolute'
            style={{
              transform: `translate3d(${x}px, ${y}px, 0)`,
              transition: 'transform 0.12s ease-out',
            }}
          >
            <RemoteCursor name={name} color={color} />
          </div>
        )
      })}
    </div>
  )
}

export const Cursors = memo(CursorsComponent)
Cursors.displayName = 'Cursors'
