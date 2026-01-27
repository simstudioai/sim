'use client'

import { memo, useMemo } from 'react'
import { useViewport } from 'reactflow'
import { getUserColor } from '@/lib/workspaces/colors'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useSocket } from '@/app/workspace/providers/socket-provider'

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
  const { presenceUsers, currentSocketId } = useSocket()
  const viewport = useViewport()
  const preventZoomRef = usePreventZoom()

  const cursors = useMemo<CursorRenderData[]>(() => {
    return presenceUsers
      .filter((user): user is typeof user & { cursor: CursorPoint } => Boolean(user.cursor))
      .filter((user) => user.socketId !== currentSocketId)
      .map((user) => ({
        id: user.socketId,
        name: user.userName?.trim() || 'Collaborator',
        cursor: user.cursor,
        color: getUserColor(user.userId),
      }))
  }, [currentSocketId, presenceUsers])

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
            <div className='relative flex items-start'>
              {/* Filled mouse pointer cursor */}
              <svg className='-mt-[18px]' width={24} height={24} viewBox='0 0 24 24' fill={color}>
                <path d='M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z' />
              </svg>

              {/* Name tag to the right, background tightly wrapping text */}
              <div
                className='ml-[-4px] inline-flex max-w-[160px] truncate whitespace-nowrap rounded-[2px] px-1.5 py-[2px] font-medium text-[11px] text-[var(--surface-1)]'
                style={{ backgroundColor: color }}
              >
                {name}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const Cursors = memo(CursorsComponent)
Cursors.displayName = 'Cursors'
