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
import { useParams } from 'next/navigation'
import { io, type Socket } from 'socket.io-client'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

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
  avatarUrl?: string | null
  cursor?: { x: number; y: number } | null
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
  emitWorkflowOperation: (
    operation: string,
    target: string,
    payload: any,
    operationId?: string
  ) => void
  emitSubblockUpdate: (
    blockId: string,
    subblockId: string,
    value: any,
    operationId?: string
  ) => void
  emitVariableUpdate: (variableId: string, field: string, value: any, operationId?: string) => void

  emitCursorUpdate: (cursor: { x: number; y: number } | null) => void
  emitSelectionUpdate: (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => void
  // Event handlers for receiving real-time updates
  onWorkflowOperation: (handler: (data: any) => void) => void
  onSubblockUpdate: (handler: (data: any) => void) => void
  onVariableUpdate: (handler: (data: any) => void) => void

  onCursorUpdate: (handler: (data: any) => void) => void
  onSelectionUpdate: (handler: (data: any) => void) => void
  onUserJoined: (handler: (data: any) => void) => void
  onUserLeft: (handler: (data: any) => void) => void
  onWorkflowDeleted: (handler: (data: any) => void) => void
  onWorkflowReverted: (handler: (data: any) => void) => void
  onOperationConfirmed: (handler: (data: any) => void) => void
  onOperationFailed: (handler: (data: any) => void) => void
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
  emitVariableUpdate: () => {},
  emitCursorUpdate: () => {},
  emitSelectionUpdate: () => {},
  onWorkflowOperation: () => {},
  onSubblockUpdate: () => {},
  onVariableUpdate: () => {},
  onCursorUpdate: () => {},
  onSelectionUpdate: () => {},
  onUserJoined: () => {},
  onUserLeft: () => {},
  onWorkflowDeleted: () => {},
  onWorkflowReverted: () => {},
  onOperationConfirmed: () => {},
  onOperationFailed: () => {},
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
  const initializedRef = useRef(false)

  // Get current workflow ID from URL params
  const params = useParams()
  const urlWorkflowId = params?.workflowId as string | undefined

  // Use refs to store event handlers to avoid stale closures
  const eventHandlers = useRef<{
    workflowOperation?: (data: any) => void
    subblockUpdate?: (data: any) => void
    variableUpdate?: (data: any) => void

    cursorUpdate?: (data: any) => void
    selectionUpdate?: (data: any) => void
    userJoined?: (data: any) => void
    userLeft?: (data: any) => void
    workflowDeleted?: (data: any) => void
    workflowReverted?: (data: any) => void
    operationConfirmed?: (data: any) => void
    operationFailed?: (data: any) => void
  }>({})

  // Helper function to generate a fresh socket token
  const generateSocketToken = async (): Promise<string> => {
    // Avoid overlapping token requests
    const res = await fetch('/api/auth/socket-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'cache-control': 'no-store' },
    })
    if (!res.ok) throw new Error('Failed to generate socket token')
    const body = await res.json().catch(() => ({}))
    const token = body?.token
    if (!token || typeof token !== 'string') throw new Error('Invalid socket token')
    return token
  }

  // Initialize socket when user is available - only once per session
  useEffect(() => {
    if (!user?.id) return

    // Only initialize if we don't have a socket and aren't already connecting
    if (initializedRef.current || socket || isConnecting) {
      logger.info('Socket already exists or is connecting, skipping initialization')
      return
    }

    logger.info('Initializing socket connection for user:', user.id)
    initializedRef.current = true
    setIsConnecting(true)

    const initializeSocket = async () => {
      try {
        // Generate initial token for socket authentication
        const token = await generateSocketToken()

        const socketUrl = getEnv('NEXT_PUBLIC_SOCKET_URL') || 'http://localhost:3002'

        logger.info('Attempting to connect to Socket.IO server', {
          url: socketUrl,
          userId: user?.id || 'no-user',
          hasToken: !!token,
          timestamp: new Date().toISOString(),
        })

        const socketInstance = io(socketUrl, {
          transports: ['websocket', 'polling'], // Keep polling fallback for reliability
          withCredentials: true,
          reconnectionAttempts: Number.POSITIVE_INFINITY, // Socket.IO handles base reconnection
          reconnectionDelay: 1000, // Start with 1 second delay
          reconnectionDelayMax: 30000, // Max 30 second delay
          timeout: 10000, // Back to original timeout
          auth: async (cb) => {
            try {
              const freshToken = await generateSocketToken()
              cb({ token: freshToken })
            } catch (error) {
              logger.error('Failed to generate fresh token for connection:', error)
              cb({ token: null })
            }
          },
        })

        // Connection events
        socketInstance.on('connect', () => {
          setIsConnected(true)
          setIsConnecting(false)
          logger.info('Socket connected successfully', {
            socketId: socketInstance.id,
            connected: socketInstance.connected,
            transport: socketInstance.io.engine?.transport?.name,
          })

          // Automatically join the current workflow room based on URL
          // This handles both initial connections and reconnections
          if (urlWorkflowId) {
            logger.info(`Joining workflow room after connection: ${urlWorkflowId}`)
            socketInstance.emit('join-workflow', {
              workflowId: urlWorkflowId,
            })
            // Update our internal state to match the URL
            setCurrentWorkflowId(urlWorkflowId)
          }
        })

        socketInstance.on('disconnect', (reason) => {
          setIsConnected(false)
          setIsConnecting(false)

          logger.info('Socket disconnected', {
            reason,
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

          // Authentication errors now indicate either session expiry or token generation issues
          if (
            error.message?.includes('Token validation failed') ||
            error.message?.includes('Authentication failed') ||
            error.message?.includes('Authentication required')
          ) {
            logger.warn(
              'Authentication failed - this could indicate session expiry or token generation issues'
            )
            // The fresh token generation on each attempt should handle most cases automatically
            // If this persists, user may need to refresh page or re-login
          }
        })

        // Socket.IO provides reconnection logging with attempt numbers
        socketInstance.on('reconnect', (attemptNumber) => {
          logger.info('Socket reconnected successfully', {
            attemptNumber,
            socketId: socketInstance.id,
            transport: socketInstance.io.engine?.transport?.name,
          })
          // Note: Workflow rejoining is handled by the 'connect' event which fires for both initial connections and reconnections
        })

        socketInstance.on('reconnect_attempt', (attemptNumber) => {
          logger.info('Socket reconnection attempt (fresh token will be generated)', {
            attemptNumber,
            timestamp: new Date().toISOString(),
          })
        })

        socketInstance.on('reconnect_error', (error: any) => {
          logger.error('Socket reconnection error:', {
            message: error.message,
            attemptNumber: error.attemptNumber,
            type: error.type,
          })
        })

        socketInstance.on('reconnect_failed', () => {
          logger.error('Socket reconnection failed - all attempts exhausted')
          setIsConnecting(false)
        })

        // Presence events
        socketInstance.on('presence-update', (users: PresenceUser[]) => {
          setPresenceUsers(users)
        })

        // Note: user-joined and user-left events removed in favor of authoritative presence-update

        // Workflow operation events
        socketInstance.on('workflow-operation', (data) => {
          eventHandlers.current.workflowOperation?.(data)
        })

        // Subblock update events
        socketInstance.on('subblock-update', (data) => {
          eventHandlers.current.subblockUpdate?.(data)
        })

        // Variable update events
        socketInstance.on('variable-update', (data) => {
          eventHandlers.current.variableUpdate?.(data)
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

        // Workflow revert events
        socketInstance.on('workflow-reverted', (data) => {
          logger.info(`Workflow ${data.workflowId} has been reverted to deployed state`)
          eventHandlers.current.workflowReverted?.(data)
        })

        // Workflow update events (external changes like LLM edits)
        socketInstance.on('workflow-updated', (data) => {
          logger.info(`Workflow ${data.workflowId} has been updated externally - requesting sync`)
          // Request fresh workflow state to sync with external changes
          if (data.workflowId === urlWorkflowId) {
            socketInstance.emit('request-sync', { workflowId: data.workflowId })
          }
        })

        // Shared function to rehydrate workflow stores
        const rehydrateWorkflowStores = async (
          workflowId: string,
          workflowState: any,
          source: 'copilot' | 'workflow-state'
        ) => {
          // Import stores dynamically
          const [
            { useOperationQueueStore },
            { useWorkflowRegistry },
            { useWorkflowStore },
            { useSubBlockStore },
          ] = await Promise.all([
            import('@/stores/operation-queue/store'),
            import('@/stores/workflows/registry/store'),
            import('@/stores/workflows/workflow/store'),
            import('@/stores/workflows/subblock/store'),
          ])

          // Only proceed if this is the active workflow
          const { activeWorkflowId } = useWorkflowRegistry.getState()
          if (activeWorkflowId !== workflowId) {
            logger.info(`Skipping rehydration - workflow ${workflowId} is not active`)
            return false
          }

          // Check for pending operations
          const hasPending = useOperationQueueStore
            .getState()
            .operations.some((op: any) => op.workflowId === workflowId && op.status !== 'confirmed')
          if (hasPending) {
            logger.info(`Skipping ${source} rehydration due to pending operations in queue`)
            return false
          }

          // Extract subblock values from blocks
          const subblockValues: Record<string, Record<string, any>> = {}
          Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
            const blockState = block as any
            subblockValues[blockId] = {}
            Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
              subblockValues[blockId][subblockId] = (subblock as any).value
            })
          })

          // Replace local workflow store with authoritative server state
          useWorkflowStore.setState({
            blocks: workflowState.blocks || {},
            edges: workflowState.edges || [],
            loops: workflowState.loops || {},
            parallels: workflowState.parallels || {},
            lastSaved: workflowState.lastSaved || Date.now(),
            isDeployed: workflowState.isDeployed ?? false,
            deployedAt: workflowState.deployedAt,
            deploymentStatuses: workflowState.deploymentStatuses || {},
          })

          // Replace subblock store values for this workflow
          useSubBlockStore.setState((state: any) => ({
            workflowValues: {
              ...state.workflowValues,
              [workflowId]: subblockValues,
            },
          }))

          logger.info(`Successfully rehydrated stores from ${source}`)
          return true
        }

        // Copilot workflow edit events (database has been updated, rehydrate stores)
        socketInstance.on('copilot-workflow-edit', async (data) => {
          logger.info(
            `Copilot edited workflow ${data.workflowId} - rehydrating stores from database`
          )

          try {
            // Fetch fresh workflow state directly from API
            const response = await fetch(`/api/workflows/${data.workflowId}`)
            if (response.ok) {
              const responseData = await response.json()
              const workflowData = responseData.data

              if (workflowData?.state) {
                await rehydrateWorkflowStores(data.workflowId, workflowData.state, 'copilot')
              }
            } else {
              logger.error('Failed to fetch fresh workflow state:', response.statusText)
            }
          } catch (error) {
            logger.error('Failed to rehydrate stores after copilot edit:', error)
          }
        })

        // Operation confirmation events
        socketInstance.on('operation-confirmed', (data) => {
          logger.debug('Operation confirmed', { operationId: data.operationId })
          eventHandlers.current.operationConfirmed?.(data)
        })

        // Operation failure events
        socketInstance.on('operation-failed', (data) => {
          logger.warn('Operation failed', { operationId: data.operationId, error: data.error })
          eventHandlers.current.operationFailed?.(data)
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

        socketInstance.on('workflow-state', async (workflowData) => {
          logger.info('Received workflow state from server')

          if (workflowData?.state) {
            await rehydrateWorkflowStores(workflowData.id, workflowData.state, 'workflow-state')
          }
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

    // Cleanup on unmount only (not on user change since socket is session-level)
    return () => {
      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()
    }
  }, [user?.id])

  // Handle workflow room switching when URL changes (for navigation between workflows)
  useEffect(() => {
    if (!socket || !isConnected || !urlWorkflowId) return

    // If we're already in the correct workflow room, no need to switch
    if (currentWorkflowId === urlWorkflowId) return

    logger.info(
      `URL workflow changed from ${currentWorkflowId} to ${urlWorkflowId}, switching rooms`
    )

    // Leave current workflow first if we're in one
    if (currentWorkflowId) {
      logger.info(`Leaving current workflow ${currentWorkflowId} before joining ${urlWorkflowId}`)
      socket.emit('leave-workflow')
    }

    // Join the new workflow room
    logger.info(`Joining workflow room: ${urlWorkflowId}`)
    socket.emit('join-workflow', {
      workflowId: urlWorkflowId,
    })
    setCurrentWorkflowId(urlWorkflowId)
  }, [socket, isConnected, urlWorkflowId, currentWorkflowId])

  // Cleanup socket on component unmount
  useEffect(() => {
    return () => {
      if (socket) {
        logger.info('Cleaning up socket connection on unmount')
        socket.disconnect()
      }
    }
  }, [])

  // Join workflow room
  const joinWorkflow = useCallback(
    (workflowId: string) => {
      if (!socket || !user?.id) {
        logger.warn('Cannot join workflow: socket or user not available')
        return
      }

      // Prevent duplicate joins to the same workflow
      if (currentWorkflowId === workflowId) {
        logger.info(`Already in workflow ${workflowId}, skipping join`)
        return
      }

      // Leave current workflow first if we're in one
      if (currentWorkflowId) {
        logger.info(`Leaving current workflow ${currentWorkflowId} before joining ${workflowId}`)
        socket.emit('leave-workflow')
      }

      logger.info(`Joining workflow: ${workflowId}`)
      socket.emit('join-workflow', {
        workflowId, // Server gets user info from authenticated session
      })
      setCurrentWorkflowId(workflowId)
    },
    [socket, user, currentWorkflowId]
  )

  // Leave current workflow room
  const leaveWorkflow = useCallback(() => {
    if (socket && currentWorkflowId) {
      logger.info(`Leaving workflow: ${currentWorkflowId}`)
      try {
        const { useOperationQueueStore } = require('@/stores/operation-queue/store')
        useOperationQueueStore.getState().cancelOperationsForWorkflow(currentWorkflowId)
      } catch {}
      socket.emit('leave-workflow')
      setCurrentWorkflowId(null)
      setPresenceUsers([])

      // Clean up any pending position updates
      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()
    }
  }, [socket, currentWorkflowId])

  // Light throttling for position updates to ensure smooth collaborative movement
  const positionUpdateTimeouts = useRef<Map<string, number>>(new Map())
  const pendingPositionUpdates = useRef<Map<string, any>>(new Map())

  // Emit workflow operations (blocks, edges, subflows)
  const emitWorkflowOperation = useCallback(
    (operation: string, target: string, payload: any, operationId?: string) => {
      if (!socket || !currentWorkflowId) {
        return
      }

      // Apply light throttling only to position updates for smooth collaborative experience
      const isPositionUpdate = operation === 'update-position' && target === 'block'
      const { commit = true } = payload || {}

      if (isPositionUpdate && payload.id) {
        const blockId = payload.id

        if (commit) {
          socket.emit('workflow-operation', {
            operation,
            target,
            payload,
            timestamp: Date.now(),
            operationId,
          })
          pendingPositionUpdates.current.delete(blockId)
          const timeoutId = positionUpdateTimeouts.current.get(blockId)
          if (timeoutId) {
            clearTimeout(timeoutId)
            positionUpdateTimeouts.current.delete(blockId)
          }
          return
        }

        pendingPositionUpdates.current.set(blockId, {
          operation,
          target,
          payload,
          timestamp: Date.now(),
          operationId,
        })

        if (!positionUpdateTimeouts.current.has(blockId)) {
          const timeoutId = window.setTimeout(() => {
            const latestUpdate = pendingPositionUpdates.current.get(blockId)
            if (latestUpdate) {
              socket.emit('workflow-operation', latestUpdate)
              pendingPositionUpdates.current.delete(blockId)
            }
            positionUpdateTimeouts.current.delete(blockId)
          }, 33)

          positionUpdateTimeouts.current.set(blockId, timeoutId)
        }
      } else {
        // For all non-position updates, emit immediately
        socket.emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: Date.now(),
          operationId, // Include operation ID for queue tracking
        })
      }
    },
    [socket, currentWorkflowId]
  )

  // Emit subblock value updates
  const emitSubblockUpdate = useCallback(
    (blockId: string, subblockId: string, value: any, operationId?: string) => {
      // Only emit if socket is connected and we're in a valid workflow room
      if (socket && currentWorkflowId) {
        socket.emit('subblock-update', {
          blockId,
          subblockId,
          value,
          timestamp: Date.now(),
          operationId, // Include operation ID for queue tracking
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

  // Emit variable value updates
  const emitVariableUpdate = useCallback(
    (variableId: string, field: string, value: any, operationId?: string) => {
      // Only emit if socket is connected and we're in a valid workflow room
      if (socket && currentWorkflowId) {
        socket.emit('variable-update', {
          variableId,
          field,
          value,
          timestamp: Date.now(),
          operationId, // Include operation ID for queue tracking
        })
      } else {
        logger.warn('Cannot emit variable update: no socket connection or workflow room', {
          hasSocket: !!socket,
          currentWorkflowId,
          variableId,
          field,
        })
      }
    },
    [socket, currentWorkflowId]
  )

  // Cursor throttling optimized for database connection health
  const lastCursorEmit = useRef(0)
  const emitCursorUpdate = useCallback(
    (cursor: { x: number; y: number } | null) => {
      if (!socket || !currentWorkflowId) {
        return
      }

      const now = performance.now()

      if (cursor === null) {
        socket.emit('cursor-update', { cursor: null })
        lastCursorEmit.current = now
        return
      }

      // Reduced to 30fps (33ms) to reduce database load while maintaining smooth UX
      if (now - lastCursorEmit.current >= 33) {
        socket.emit('cursor-update', { cursor })
        lastCursorEmit.current = now
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

  const onVariableUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.variableUpdate = handler
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

  const onWorkflowReverted = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowReverted = handler
  }, [])

  const onOperationConfirmed = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.operationConfirmed = handler
  }, [])

  const onOperationFailed = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.operationFailed = handler
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
        emitVariableUpdate,

        emitCursorUpdate,
        emitSelectionUpdate,
        onWorkflowOperation,
        onSubblockUpdate,
        onVariableUpdate,

        onCursorUpdate,
        onSelectionUpdate,
        onUserJoined,
        onUserLeft,
        onWorkflowDeleted,
        onWorkflowReverted,
        onOperationConfirmed,
        onOperationFailed,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}
