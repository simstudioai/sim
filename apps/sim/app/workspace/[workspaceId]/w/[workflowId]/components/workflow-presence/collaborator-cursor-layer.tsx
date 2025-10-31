'use client'

import { memo, useMemo } from 'react'
import { useViewport } from 'reactflow'
import { useSession } from '@/lib/auth-client'
import { getPresenceColors } from '@/lib/collaboration/presence-colors'
import { useSocket } from '@/contexts/socket-context'

interface CursorPoint {
  x: number
  y: number
}

interface CursorRenderData {
  id: string
  name: string
  cursor: CursorPoint
  gradient: string
  accentColor: string
}

const POINTER_OFFSET = {
  x: 2,
  y: 18,
}

const LABEL_BACKGROUND = 'rgba(15, 23, 42, 0.88)'

const CollaboratorCursorLayerComponent = () => {
  const { presenceUsers } = useSocket()
  const viewport = useViewport()
  const session = useSession()
  const currentUserId = session.data?.user?.id

  const cursors = useMemo<CursorRenderData[]>(() => {
    if (!presenceUsers.length) {
      return []
    }

    return presenceUsers
      .filter((user): user is typeof user & { cursor: CursorPoint } => Boolean(user.cursor))
      .filter((user) => user.userId !== currentUserId)
      .map((user) => {
        const cursor = user.cursor
        const name = user.userName?.trim() || 'Collaborator'
        const { gradient, accentColor } = getPresenceColors(user.userId)

        return {
          id: user.socketId,
          name,
          cursor,
          gradient,
          accentColor,
        }
      })
  }, [currentUserId, presenceUsers])

  if (!cursors.length) {
    return null
  }

  return (
    <div className='pointer-events-none absolute inset-0 z-30 select-none'>
      {cursors.map(({ id, name, cursor, gradient, accentColor }) => {
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
              <svg
                width={20}
                height={22}
                viewBox='0 0 20 22'
                className='drop-shadow-md'
                style={{ fill: accentColor, stroke: 'white', strokeWidth: 1.25 }}
              >
                <path d='M1 0L1 17L6.2 12.5L10.5 21.5L13.7 19.8L9.4 10.7L18.5 10.7L1 0Z' />
              </svg>

              <div
                className='absolute top-[-28px] left-4 flex items-center gap-2 rounded-full px-2 py-1 font-medium text-white text-xs shadow-lg'
                style={{
                  background: LABEL_BACKGROUND,
                  border: `1px solid ${accentColor}`,
                  backdropFilter: 'blur(8px)',
                }}
              >
                <span
                  className='h-2.5 w-2.5 rounded-full border border-white/60'
                  style={{ background: gradient }}
                />
                <span>{name}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const CollaboratorCursorLayer = memo(CollaboratorCursorLayerComponent)
CollaboratorCursorLayer.displayName = 'CollaboratorCursorLayer'
