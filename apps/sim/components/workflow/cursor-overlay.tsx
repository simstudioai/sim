'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import { useSocket } from '@/contexts/socket-context'

const logger = createLogger('CursorOverlay')

interface CursorData {
  socketId: string
  userId: string
  userName: string
  cursor: { x: number; y: number }
}

interface CursorOverlayProps {
  containerRef: React.RefObject<HTMLElement>
  className?: string
}

// Generate a consistent color for each user based on their ID
function getUserColor(userId: string): string {
  const colors = [
    '#ef4444', // red-500
    '#f97316', // orange-500
    '#eab308', // yellow-500
    '#22c55e', // green-500
    '#06b6d4', // cyan-500
    '#3b82f6', // blue-500
    '#8b5cf6', // violet-500
    '#ec4899', // pink-500
    '#f59e0b', // amber-500
    '#10b981', // emerald-500
  ]

  // Simple hash function to get consistent color
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) & 0xffffffff
  }

  return colors[Math.abs(hash) % colors.length]
}

function UserCursor({
  cursor,
  userName,
  userId,
}: {
  cursor: CursorData
  userName: string
  userId: string
}) {
  const [isVisible, setIsVisible] = useState(true)
  const color = getUserColor(userId)

  // Hide cursor after inactivity
  useEffect(() => {
    setIsVisible(true)
    const timeout = setTimeout(() => {
      setIsVisible(false)
    }, 3000) // Hide after 3 seconds of inactivity

    return () => clearTimeout(timeout)
  }, [cursor.cursor.x, cursor.cursor.y])

  if (!isVisible) return null

  return (
    <div
      className='pointer-events-none absolute z-50 transition-all duration-100 ease-out'
      style={{
        left: cursor.cursor.x,
        top: cursor.cursor.y,
        transform: 'translate(-2px, -2px)',
      }}
    >
      {/* Cursor pointer */}
      <svg width='20' height='20' viewBox='0 0 20 20' fill='none' className='drop-shadow-sm'>
        <path d='M2 2L18 8L8 12L2 18V2Z' fill={color} stroke='white' strokeWidth='1' />
      </svg>

      {/* User name label */}
      <div
        className='absolute top-5 left-2 whitespace-nowrap rounded px-2 py-1 font-medium text-white text-xs shadow-lg'
        style={{ backgroundColor: color }}
      >
        {userName}
      </div>
    </div>
  )
}

export function CursorOverlay({ containerRef, className }: CursorOverlayProps) {
  const { presenceUsers, socket } = useSocket()
  const [cursors, setCursors] = useState<Map<string, CursorData>>(new Map())
  const [containerBounds, setContainerBounds] = useState<DOMRect | null>(null)

  // Update container bounds when container changes
  useEffect(() => {
    if (!containerRef.current) return

    const updateBounds = () => {
      setContainerBounds(containerRef.current?.getBoundingClientRect() || null)
    }

    updateBounds()

    const resizeObserver = new ResizeObserver(updateBounds)
    resizeObserver.observe(containerRef.current)

    window.addEventListener('scroll', updateBounds)
    window.addEventListener('resize', updateBounds)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('scroll', updateBounds)
      window.removeEventListener('resize', updateBounds)
    }
  }, [containerRef])

  // Listen for cursor updates
  useEffect(() => {
    if (!socket) return

    const handleCursorUpdate = (data: {
      socketId: string
      userId: string
      userName: string
      cursor: { x: number; y: number }
    }) => {
      setCursors(
        (prev) =>
          new Map(
            prev.set(data.socketId, {
              socketId: data.socketId,
              userId: data.userId,
              userName: data.userName,
              cursor: data.cursor,
            })
          )
      )
    }

    const handleUserLeft = (data: { socketId: string }) => {
      setCursors((prev) => {
        const updated = new Map(prev)
        updated.delete(data.socketId)
        return updated
      })
    }

    socket.on('cursor-update', handleCursorUpdate)
    socket.on('user-left', handleUserLeft)

    return () => {
      socket.off('cursor-update', handleCursorUpdate)
      socket.off('user-left', handleUserLeft)
    }
  }, [socket])

  // Send cursor updates when mouse moves in container
  useEffect(() => {
    if (!socket || !containerRef.current || !containerBounds) return

    const container = containerRef.current

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      // Only send if cursor is within container bounds
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        socket.emit('cursor-update', {
          cursor: { x, y },
        })
      }
    }

    const handleMouseLeave = () => {
      // Could emit cursor-leave event if needed
    }

    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [socket, containerRef, containerBounds])

  if (!containerBounds) return null

  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      {Array.from(cursors.values()).map((cursor) => (
        <UserCursor
          key={cursor.socketId}
          cursor={cursor}
          userName={cursor.userName}
          userId={cursor.userId}
        />
      ))}
    </div>
  )
}
