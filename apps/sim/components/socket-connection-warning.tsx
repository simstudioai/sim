'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useSocket } from '@/contexts/socket-context'

interface SocketConnectionWarningProps {
  className?: string
}

export function SocketConnectionWarning({ className }: SocketConnectionWarningProps) {
  // Local state that resets on every page load/refresh
  const [showWarning, setShowWarning] = useState(false)

  const { socket } = useSocket()

  useEffect(() => {
    // Listen for custom connection error events from socket context
    const handleConnectionError = (event: CustomEvent) => {
      console.error('Socket connection error detected:', event.detail.error)
      setShowWarning(true)
    }

    // Listen for custom events dispatched by socket context
    window.addEventListener('socket-connection-error', handleConnectionError as EventListener)

    // Also listen for actual socket errors if socket is available
    if (socket) {
      const handleSocketError = (error: any) => {
        console.error('Socket error detected:', error)
        setShowWarning(true)
      }

      const handleOperationError = (error: any) => {
        console.error('Socket operation error detected:', error)
        setShowWarning(true)
      }

      const handleOperationForbidden = (error: any) => {
        console.warn('Socket operation forbidden:', error)
        setShowWarning(true)
      }

      const handleDisconnect = (reason: string) => {
        // Only show warning for unexpected disconnections, not normal ones
        if (
          reason === 'io server disconnect' ||
          reason === 'transport close' ||
          reason === 'transport error'
        ) {
          console.warn('Socket disconnected unexpectedly:', reason)
          setShowWarning(true)
        }
      }

      // Attach socket event listeners
      socket.on('error', handleSocketError)
      socket.on('operation-error', handleOperationError)
      socket.on('operation-forbidden', handleOperationForbidden)
      socket.on('disconnect', handleDisconnect)

      // Cleanup socket listeners
      return () => {
        window.removeEventListener(
          'socket-connection-error',
          handleConnectionError as EventListener
        )
        socket.off('error', handleSocketError)
        socket.off('operation-error', handleOperationError)
        socket.off('operation-forbidden', handleOperationForbidden)
        socket.off('disconnect', handleDisconnect)
      }
    }

    // Cleanup custom event listener if no socket
    return () => {
      window.removeEventListener('socket-connection-error', handleConnectionError as EventListener)
    }
  }, [socket])

  // Warning should persist until page refresh - don't auto-clear on successful connection
  // This ensures users know they should refresh to ensure data consistency

  if (!showWarning) return null

  return (
    <div
      className={`flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1 text-destructive text-sm ${className || ''}`}
    >
      <AlertTriangle className='h-4 w-4' />
      <span>Connection issues detected. Please refresh to make sure changes are saved.</span>
    </div>
  )
}
