'use client'

import { memo, useMemo } from 'react'
import { useViewport } from 'reactflow'
import { useSession } from '@/lib/auth-client'
import { getUserColor } from '@/app/workspace/[workspaceId]/w/utils/get-user-color'
import { useSocket } from '@/contexts/socket-context'

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

const POINTER_OFFSET = {
  x: 0,
  y: 0,
}

const CursorsComponent = () => {
  const { presenceUsers } = useSocket()
  const viewport = useViewport()
  const session = useSession()
  const currentUserId = session.data?.user?.id

  const cursors = useMemo<CursorRenderData[]>(() => {
    return presenceUsers
      .filter((user): user is typeof user & { cursor: CursorPoint } => Boolean(user.cursor))
      .filter((user) => user.userId !== currentUserId)
      .map((user) => ({
        id: user.socketId,
        name: user.userName?.trim() || 'Collaborator',
        cursor: user.cursor,
        color: getUserColor(user.userId),
      }))
  }, [currentUserId, presenceUsers])

  if (!cursors.length) {
    return null
  }

  return (
    <div className='pointer-events-none absolute inset-0 z-30 select-none'>
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
            <div
              className='relative'
              style={{ transform: `translate(${-POINTER_OFFSET.x}px, ${-POINTER_OFFSET.y}px)` }}
            >
              {/* Simple cursor pointer */}
              <svg width={16} height={18} viewBox='0 0 16 18' fill='none'>
                <path
                  d='M0.5 0.5L0.5 12L4 9L6.5 15L8.5 14L6 8L12 8L0.5 0.5Z'
                  fill={color}
                  stroke='rgba(0,0,0,0.3)'
                  strokeWidth={1}
                />
              </svg>

              {/* Name tag underneath and to the right */}
              <div
                className='absolute top-[18px] left-[4px] h-[21px] w-[140px] truncate whitespace-nowrap rounded-[2px] p-[6px] font-medium text-[11px] text-[var(--surface-1)]'
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
