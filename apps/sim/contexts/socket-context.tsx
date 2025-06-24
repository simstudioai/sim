'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { io, type Socket } from 'socket.io-client'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SocketContext')

interface User {
  id: string
  name?: string
  email?: string
}

interface PresenceUser {
  socketId: string
  userId: string
  userName: string
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  isConnecting: boolean
  currentWorkflowId: string | null
  presenceUsers: PresenceUser[]
  joinWorkflow: (workflowId: string) => void
  leaveWorkflow: () => void
  emitWorkflowOperation: (operation: string, target: string, payload: any) => void
  emitSubblockUpdate: (blockId: string, subblockId: string, value: any) => void
  emitCursorUpdate: (cursor: { x: number; y: number }) => void
  emitSelectionUpdate: (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => void
  // Event handlers for receiving real-time updates
  onWorkflowOperation: (handler: (data: any) => void) => void
  onSubblockUpdate: (handler: (data: any) => void) => void
  onCursorUpdate: (handler: (data: any) => void) => void
  onSelectionUpdate: (handler: (data: any) => void) => void
  onUserJoined: (handler: (data: any) => void) => void
  onUserLeft: (handler: (data: any) => void) => void
  onWorkflowDeleted: (handler: (data: any) => void) => void
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isConnecting: false,
  currentWorkflowId: null,
  presenceUsers: [],
  joinWorkflow: () => {},
  leaveWorkflow: () => {},
  emitWorkflowOperation: () => {},
  emitSubblockUpdate: () => {},
  emitCursorUpdate: () => {},
  emitSelectionUpdate: () => {},
  onWorkflowOperation: () => {},
  onSubblockUpdate: () => {},
  onCursorUpdate: () => {},
  onSelectionUpdate: () => {},
  onUserJoined: () => {},
  onUserLeft: () => {},
  onWorkflowDeleted: () => {},
})

export const useSocket = () => useContext(SocketContext)

interface SocketProviderProps {
  children: ReactNode
  user?: User
}

export function SocketProvider({ children, user }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])

  // Connection health monitoring
  const connectionHealth = useRef({ latency: 0, lastPing: 0, reconnectCount: 0 })
  const healthCheckInterval = useRef<NodeJS.Timeout | null>(null)

  // Use refs to store event handlers to avoid stale closures
  const eventHandlers = useRef<{
    workflowOperation?: (data: any) => void
    subblockUpdate?: (data: any) => void
    cursorUpdate?: (data: any) => void
    selectionUpdate?: (data: any) => void
    userJoined?: (data: any) => void
    userLeft?: (data: any) => void
    workflowDeleted?: (data: any) => void
  }>({})

  // Initialize socket when user is available
  useEffect(() => {
    if (!user?.id || socket) return

    logger.info('Initializing socket connection for user:', user.id)
    setIsConnecting(true)

    const initializeSocket = async () => {
      try {
        // Generate one-time token for socket authentication
        const tokenResponse = await fetch('/api/auth/socket-token', {
          method: 'POST',
          credentials: 'include',
        })

        if (!tokenResponse.ok) {
          throw new Error('Failed to generate socket token')
        }

        const { token } = await tokenResponse.json()

        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002'

        logger.info('Attempting to connect to Socket.IO server', {
          url: socketUrl,
          userId: user?.id || 'no-user',
          hasToken: !!token,
          timestamp: new Date().toISOString(),
        })

        const socketInstance = io(socketUrl, {
          transports: ['websocket', 'polling'], // Keep polling fallback for reliability
          withCredentials: true,
          reconnectionAttempts: 5, // Back to original conservative setting
          timeout: 10000, // Back to original timeout
          auth: {
            token, // Send one-time token for authentication
          },
        })

        // Connection health monitoring
        const startHealthMonitoring = () => {
          if (healthCheckInterval.current) {
            clearInterval(healthCheckInterval.current)
          }

          healthCheckInterval.current = setInterval(() => {
            if (socketInstance.connected) {
              const pingStart = performance.now()
              connectionHealth.current.lastPing = pingStart

              socketInstance.emit('ping', pingStart)
            }
          }, 5000) // Check every 5 seconds
        }

        // Connection events
        socketInstance.on('connect', () => {
          setIsConnected(true)
          setIsConnecting(false)
          connectionHealth.current.reconnectCount = 0
          startHealthMonitoring()

          logger.info('Socket connected successfully', {
            socketId: socketInstance.id,
            connected: socketInstance.connected,
            transport: socketInstance.io.engine?.transport?.name,
            reconnectCount: connectionHealth.current.reconnectCount,
          })
        })

        // Handle pong for latency measurement
        socketInstance.on('pong', (pingStart: number) => {
          const latency = performance.now() - pingStart
          connectionHealth.current.latency = latency

          // Adapt throttling based on latency
          if (latency > 100 && throttleDelay.current < 12) {
            throttleDelay.current = Math.min(16, throttleDelay.current + 2)
          } else if (latency < 50 && throttleDelay.current > 4) {
            throttleDelay.current = Math.max(2, throttleDelay.current - 1)
          }
        })

        socketInstance.on('disconnect', (reason) => {
          setIsConnected(false)
          setIsConnecting(false)

          // Stop health monitoring
          if (healthCheckInterval.current) {
            clearInterval(healthCheckInterval.current)
            healthCheckInterval.current = null
          }

          logger.info('Socket disconnected', {
            reason,
            latency: connectionHealth.current.latency,
            reconnectCount: connectionHealth.current.reconnectCount,
          })

          // Clear presence when disconnected
          setPresenceUsers([])
        })

        socketInstance.on('connect_error', (error: any) => {
          setIsConnecting(false)
          logger.error('Socket connection error:', {
            message: error.message,
            stack: error.stack,
            description: error.description,
            type: error.type,
            transport: error.transport,
          })
        })

        // Add reconnection logging
        socketInstance.on('reconnect', (attemptNumber) => {
          connectionHealth.current.reconnectCount = attemptNumber
          startHealthMonitoring() // Restart health monitoring on reconnect
          logger.info('Socket reconnected', {
            attemptNumber,
            latency: connectionHealth.current.latency,
          })
        })

        socketInstance.on('reconnect_attempt', (attemptNumber) => {
          logger.info('Socket reconnection attempt', { attemptNumber })
        })

        socketInstance.on('reconnect_error', (error: any) => {
          logger.error('Socket reconnection error:', error)
        })

        socketInstance.on('reconnect_failed', () => {
          logger.error('Socket reconnection failed - all attempts exhausted')
        })

        // Presence events
        socketInstance.on('presence-update', (users: PresenceUser[]) => {
          setPresenceUsers(users)
        })

        socketInstance.on('user-joined', (userData) => {
          setPresenceUsers((prev) => [...prev, userData])
          eventHandlers.current.userJoined?.(userData)
        })

        socketInstance.on('user-left', ({ userId, socketId }) => {
          setPresenceUsers((prev) => prev.filter((u) => u.socketId !== socketId))
          eventHandlers.current.userLeft?.({ userId, socketId })
        })

        // Workflow operation events
        socketInstance.on('workflow-operation', (data) => {
          eventHandlers.current.workflowOperation?.(data)
        })

        // Subblock update events
        socketInstance.on('subblock-update', (data) => {
          eventHandlers.current.subblockUpdate?.(data)
        })

        // Workflow deletion events
        socketInstance.on('workflow-deleted', (data) => {
          logger.warn(`Workflow ${data.workflowId} has been deleted`)
          // Clear current workflow ID if it matches the deleted workflow
          if (currentWorkflowId === data.workflowId) {
            setCurrentWorkflowId(null)
            setPresenceUsers([])
          }
          eventHandlers.current.workflowDeleted?.(data)
        })

        // Cursor update events
        socketInstance.on('cursor-update', (data) => {
          setPresenceUsers((prev) =>
            prev.map((user) =>
              user.socketId === data.socketId ? { ...user, cursor: data.cursor } : user
            )
          )
          eventHandlers.current.cursorUpdate?.(data)
        })

        // Selection update events
        socketInstance.on('selection-update', (data) => {
          setPresenceUsers((prev) =>
            prev.map((user) =>
              user.socketId === data.socketId ? { ...user, selection: data.selection } : user
            )
          )
          eventHandlers.current.selectionUpdate?.(data)
        })

        // Enhanced error handling for new server events
        socketInstance.on('error', (error) => {
          logger.error('Socket error:', error)
        })

        socketInstance.on('operation-error', (error) => {
          logger.error('Operation error:', error)
        })

        socketInstance.on('operation-forbidden', (error) => {
          logger.warn('Operation forbidden:', error)
          // Could show a toast notification to user
        })

        socketInstance.on('operation-confirmed', (data) => {
          logger.debug('Operation confirmed:', data)
        })

        socketInstance.on('workflow-state', (state) => {
          logger.info('Received workflow state from server:', state)
          // This will be used to sync initial state when joining a workflow
        })

        setSocket(socketInstance)

        return () => {
          socketInstance.close()
        }
      } catch (error) {
        logger.error('Failed to initialize socket with token:', error)
        setIsConnecting(false)
      }
    }

    // Start the socket initialization
    initializeSocket()

    // Cleanup on unmount
    return () => {
      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()
      throttleDelay.current = 4
      emitLatencies.current = []

      // Stop health monitoring
      if (healthCheckInterval.current) {
        clearInterval(healthCheckInterval.current)
        healthCheckInterval.current = null
      }
    }
  }, [user?.id])

  // Join workflow room
  const joinWorkflow = useCallback(
    (workflowId: string) => {
      if (socket && user?.id) {
        logger.info(`Joining workflow: ${workflowId}`)
        socket.emit('join-workflow', {
          workflowId, // Server gets user info from authenticated session
        })
        setCurrentWorkflowId(workflowId)
      }
    },
    [socket, user]
  )

  // Leave current workflow room
  const leaveWorkflow = useCallback(() => {
    if (socket && currentWorkflowId) {
      logger.info(`Leaving workflow: ${currentWorkflowId}`)
      socket.emit('leave-workflow')
      setCurrentWorkflowId(null)
      setPresenceUsers([])

      // Clean up any pending position updates
      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()

      // Reset adaptive throttling
      throttleDelay.current = 4
      emitLatencies.current = []
    }
  }, [socket, currentWorkflowId])

  // Position update throttling - adaptive based on network performance
  const positionUpdateTimeouts = useRef<Map<string, number>>(new Map())
  const pendingPositionUpdates = useRef<Map<string, any>>(new Map())
  const throttleDelay = useRef(4) // Start at 4ms (240fps) for maximum smoothness

  // Debug: Allow manual throttle testing (remove in production)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey) {
        switch (e.key) {
          case '1':
            throttleDelay.current = 1
            console.log('Throttle: 1ms (1000fps)')
            break
          case '2':
            throttleDelay.current = 2
            console.log('Throttle: 2ms (500fps)')
            break
          case '4':
            throttleDelay.current = 4
            console.log('Throttle: 4ms (240fps)')
            break
          case '8':
            throttleDelay.current = 8
            console.log('Throttle: 8ms (120fps)')
            break
          case '6':
            throttleDelay.current = 16
            console.log('Throttle: 16ms (60fps)')
            break
          case '0':
            throttleDelay.current = 0
            console.log('Throttle: OFF (unlimited fps)')
            break
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const lastEmitTime = useRef(0)
  const emitLatencies = useRef<number[]>([]) // Track network performance

  // Emit workflow operations (blocks, edges, subflows)
  const emitWorkflowOperation = useCallback(
    (operation: string, target: string, payload: any) => {
      if (!socket || !currentWorkflowId) return

      // Check if this is a position update that should be throttled
      const isPositionUpdate = operation === 'update-position' && target === 'block'

      if (isPositionUpdate && payload.id) {
        const blockId = payload.id

        // Store the latest position update for this block
        pendingPositionUpdates.current.set(blockId, {
          operation,
          target,
          payload,
          timestamp: Date.now(),
        })

        // Clear any existing timeout for this block
        const existingTimeout = positionUpdateTimeouts.current.get(blockId)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
        }

        // Set a new timeout to send the latest position update
        const timeoutId = window.setTimeout(
          () => {
            const latestUpdate = pendingPositionUpdates.current.get(blockId)
            if (latestUpdate) {
              const emitStartTime = performance.now()
              socket.emit('workflow-operation', latestUpdate)

              // Track emit timing for adaptive throttling
              const emitTime = performance.now()
              const timeSinceLastEmit = emitTime - lastEmitTime.current
              lastEmitTime.current = emitTime

              // If we're emitting too frequently (network might be overwhelmed), adapt
              if (timeSinceLastEmit < throttleDelay.current * 0.8) {
                emitLatencies.current.push(timeSinceLastEmit)
                // Keep only last 10 measurements
                if (emitLatencies.current.length > 10) {
                  emitLatencies.current.shift()
                }

                // If consistently fast emissions, we might need to back off
                const avgLatency =
                  emitLatencies.current.reduce((a, b) => a + b, 0) / emitLatencies.current.length
                if (avgLatency < throttleDelay.current * 0.6 && throttleDelay.current < 16) {
                  throttleDelay.current = Math.min(16, throttleDelay.current * 1.2)
                }
              } else {
                // Network is keeping up well, try to be more aggressive
                if (throttleDelay.current > 2) {
                  throttleDelay.current = Math.max(2, throttleDelay.current * 0.95)
                }
              }

              pendingPositionUpdates.current.delete(blockId)
            }
            positionUpdateTimeouts.current.delete(blockId)
          },
          throttleDelay.current === 0 ? 0 : throttleDelay.current
        ) // Allow bypassing throttle for testing

        positionUpdateTimeouts.current.set(blockId, timeoutId)
      } else {
        // For all non-position updates, emit immediately
        socket.emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: Date.now(),
        })
      }
    },
    [socket, currentWorkflowId]
  )

  // Emit subblock value updates
  const emitSubblockUpdate = useCallback(
    (blockId: string, subblockId: string, value: any) => {
      // Only emit if socket is connected and we're in a valid workflow room
      if (socket && currentWorkflowId) {
        socket.emit('subblock-update', {
          blockId,
          subblockId,
          value,
          timestamp: Date.now(),
        })
      } else {
        logger.warn('Cannot emit subblock update: no socket connection or workflow room', {
          hasSocket: !!socket,
          currentWorkflowId,
          blockId,
          subblockId,
        })
      }
    },
    [socket, currentWorkflowId]
  )

  // Throttled cursor updates (lower priority than position updates)
  const lastCursorEmit = useRef(0)
  const emitCursorUpdate = useCallback(
    (cursor: { x: number; y: number }) => {
      if (socket && currentWorkflowId) {
        const now = performance.now()
        // Throttle cursor updates to 30fps to reduce noise
        if (now - lastCursorEmit.current >= 33) {
          socket.emit('cursor-update', { cursor })
          lastCursorEmit.current = now
        }
      }
    },
    [socket, currentWorkflowId]
  )

  // Emit selection updates
  const emitSelectionUpdate = useCallback(
    (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => {
      if (socket && currentWorkflowId) {
        socket.emit('selection-update', { selection })
      }
    },
    [socket, currentWorkflowId]
  )

  // Event handler registration functions
  const onWorkflowOperation = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowOperation = handler
  }, [])

  const onSubblockUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.subblockUpdate = handler
  }, [])

  const onCursorUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.cursorUpdate = handler
  }, [])

  const onSelectionUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.selectionUpdate = handler
  }, [])

  const onUserJoined = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.userJoined = handler
  }, [])

  const onUserLeft = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.userLeft = handler
  }, [])

  const onWorkflowDeleted = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowDeleted = handler
  }, [])

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        isConnecting,
        currentWorkflowId,
        presenceUsers,
        joinWorkflow,
        leaveWorkflow,
        emitWorkflowOperation,
        emitSubblockUpdate,
        emitCursorUpdate,
        emitSelectionUpdate,
        onWorkflowOperation,
        onSubblockUpdate,
        onCursorUpdate,
        onSelectionUpdate,
        onUserJoined,
        onUserLeft,
        onWorkflowDeleted,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}
