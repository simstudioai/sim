'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { io, type Socket } from 'socket.io-client'
import { getEnv } from '@/lib/core/config/env'

const logger = createLogger('SocketContext')

const TAB_SESSION_ID_KEY = 'sim_tab_session_id'

function getTabSessionId(): string {
  if (typeof window === 'undefined') return ''

  let tabSessionId = sessionStorage.getItem(TAB_SESSION_ID_KEY)
  if (!tabSessionId) {
    tabSessionId = crypto.randomUUID()
    sessionStorage.setItem(TAB_SESSION_ID_KEY, tabSessionId)
  }
  return tabSessionId
}

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
  authFailed: boolean
  currentWorkflowId: string | null
  currentSocketId: string | null
  presenceUsers: PresenceUser[]
  joinWorkflow: (workflowId: string) => void
  leaveWorkflow: () => void
  retryConnection: () => void
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
  onWorkflowOperation: (handler: (data: any) => void) => void
  onSubblockUpdate: (handler: (data: any) => void) => void
  onVariableUpdate: (handler: (data: any) => void) => void

  onCursorUpdate: (handler: (data: any) => void) => void
  onSelectionUpdate: (handler: (data: any) => void) => void
  onWorkflowDeleted: (handler: (data: any) => void) => void
  onWorkflowReverted: (handler: (data: any) => void) => void
  onOperationConfirmed: (handler: (data: any) => void) => void
  onOperationFailed: (handler: (data: any) => void) => void
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isConnecting: false,
  authFailed: false,
  currentWorkflowId: null,
  currentSocketId: null,
  presenceUsers: [],
  joinWorkflow: () => {},
  leaveWorkflow: () => {},
  retryConnection: () => {},
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
  const [currentSocketId, setCurrentSocketId] = useState<string | null>(null)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [authFailed, setAuthFailed] = useState(false)
  const initializedRef = useRef(false)

  const params = useParams()
  const urlWorkflowId = params?.workflowId as string | undefined
  const urlWorkflowIdRef = useRef(urlWorkflowId)
  urlWorkflowIdRef.current = urlWorkflowId

  const eventHandlers = useRef<{
    workflowOperation?: (data: any) => void
    subblockUpdate?: (data: any) => void
    variableUpdate?: (data: any) => void
    cursorUpdate?: (data: any) => void
    selectionUpdate?: (data: any) => void
    workflowDeleted?: (data: any) => void
    workflowReverted?: (data: any) => void
    operationConfirmed?: (data: any) => void
    operationFailed?: (data: any) => void
  }>({})

  const positionUpdateTimeouts = useRef<Map<string, number>>(new Map())
  const pendingPositionUpdates = useRef<Map<string, any>>(new Map())

  const generateSocketToken = async (): Promise<string> => {
    const res = await fetch('/api/auth/socket-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'cache-control': 'no-store' },
    })
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Authentication required')
      }
      throw new Error('Failed to generate socket token')
    }
    const body = await res.json().catch(() => ({}))
    const token = body?.token
    if (!token || typeof token !== 'string') throw new Error('Invalid socket token')
    return token
  }

  useEffect(() => {
    if (!user?.id) return

    if (authFailed) {
      logger.info('Socket initialization skipped - auth failed, waiting for retry')
      return
    }

    if (initializedRef.current || socket || isConnecting) {
      logger.info('Socket already exists or is connecting, skipping initialization')
      return
    }

    logger.info('Initializing socket connection for user:', user.id)
    initializedRef.current = true
    setIsConnecting(true)

    const initializeSocket = () => {
      try {
        const socketUrl = getEnv('NEXT_PUBLIC_SOCKET_URL') || 'http://localhost:3002'

        logger.info('Attempting to connect to Socket.IO server', {
          url: socketUrl,
          userId: user?.id || 'no-user',
          timestamp: new Date().toISOString(),
        })

        const socketInstance = io(socketUrl, {
          transports: ['websocket', 'polling'],
          withCredentials: true,
          reconnectionAttempts: Number.POSITIVE_INFINITY,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
          timeout: 10000,
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

        socketInstance.on('connect', () => {
          setIsConnected(true)
          setIsConnecting(false)
          setCurrentSocketId(socketInstance.id ?? null)
          logger.info('Socket connected successfully', {
            socketId: socketInstance.id,
            connected: socketInstance.connected,
            transport: socketInstance.io.engine?.transport?.name,
          })
          // Note: join-workflow is handled by the useEffect watching isConnected
        })

        socketInstance.on('disconnect', (reason) => {
          setIsConnected(false)
          setIsConnecting(false)
          setCurrentSocketId(null)
          setCurrentWorkflowId(null)
          setPresenceUsers([])

          logger.info('Socket disconnected', {
            reason,
          })
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

          // Check if this is an authentication failure
          const isAuthError =
            error.message?.includes('Token validation failed') ||
            error.message?.includes('Authentication failed') ||
            error.message?.includes('Authentication required')

          if (isAuthError) {
            logger.warn(
              'Authentication failed - stopping reconnection attempts. User may need to refresh/re-login.'
            )
            // Stop reconnection attempts to prevent infinite loop
            socketInstance.disconnect()
            // Reset state to allow re-initialization when session is restored
            setSocket(null)
            setAuthFailed(true)
            initializedRef.current = false
          }
        })

        socketInstance.on('reconnect', (attemptNumber) => {
          setIsConnected(true)
          setCurrentSocketId(socketInstance.id ?? null)
          logger.info('Socket reconnected successfully', {
            attemptNumber,
            socketId: socketInstance.id,
            transport: socketInstance.io.engine?.transport?.name,
          })
          // Note: join-workflow is handled by the useEffect watching isConnected
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

        socketInstance.on('presence-update', (users: PresenceUser[]) => {
          setPresenceUsers((prev) => {
            const prevMap = new Map(prev.map((u) => [u.socketId, u]))

            return users.map((user) => {
              const existing = prevMap.get(user.socketId)
              if (existing) {
                return {
                  ...user,
                  cursor: user.cursor ?? existing.cursor,
                  selection: user.selection ?? existing.selection,
                }
              }
              return user
            })
          })
        })

        // Handle join workflow success - confirms room membership with presence list
        socketInstance.on('join-workflow-success', ({ workflowId, presenceUsers }) => {
          setCurrentWorkflowId(workflowId)
          setPresenceUsers(presenceUsers || [])
          logger.info(`Successfully joined workflow room: ${workflowId}`, {
            presenceCount: presenceUsers?.length || 0,
          })
        })

        socketInstance.on('workflow-operation', (data) => {
          eventHandlers.current.workflowOperation?.(data)
        })

        socketInstance.on('subblock-update', (data) => {
          eventHandlers.current.subblockUpdate?.(data)
        })

        socketInstance.on('variable-update', (data) => {
          eventHandlers.current.variableUpdate?.(data)
        })

        socketInstance.on('workflow-deleted', (data) => {
          logger.warn(`Workflow ${data.workflowId} has been deleted`)
          setCurrentWorkflowId((current) => {
            if (current === data.workflowId) {
              setPresenceUsers([])
              return null
            }
            return current
          })
          eventHandlers.current.workflowDeleted?.(data)
        })

        socketInstance.on('workflow-reverted', (data) => {
          logger.info(`Workflow ${data.workflowId} has been reverted to deployed state`)
          eventHandlers.current.workflowReverted?.(data)
        })

        const rehydrateWorkflowStores = async (
          workflowId: string,
          workflowState: any,
          source: 'copilot' | 'workflow-state'
        ) => {
          const [
            { useOperationQueueStore },
            { useWorkflowRegistry },
            { useWorkflowStore },
            { useSubBlockStore },
            { useWorkflowDiffStore },
          ] = await Promise.all([
            import('@/stores/operation-queue/store'),
            import('@/stores/workflows/registry/store'),
            import('@/stores/workflows/workflow/store'),
            import('@/stores/workflows/subblock/store'),
            import('@/stores/workflow-diff/store'),
          ])

          const { activeWorkflowId } = useWorkflowRegistry.getState()
          if (activeWorkflowId !== workflowId) {
            logger.info(`Skipping rehydration - workflow ${workflowId} is not active`)
            return false
          }

          const hasPending = useOperationQueueStore
            .getState()
            .operations.some((op: any) => op.workflowId === workflowId && op.status !== 'confirmed')
          if (hasPending) {
            logger.info(`Skipping ${source} rehydration due to pending operations in queue`)
            return false
          }

          const subblockValues: Record<string, Record<string, any>> = {}
          Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
            const blockState = block as any
            subblockValues[blockId] = {}
            Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
              subblockValues[blockId][subblockId] = (subblock as any).value
            })
          })

          useWorkflowStore.getState().replaceWorkflowState({
            blocks: workflowState.blocks || {},
            edges: workflowState.edges || [],
            loops: workflowState.loops || {},
            parallels: workflowState.parallels || {},
            lastSaved: workflowState.lastSaved || Date.now(),
            deploymentStatuses: workflowState.deploymentStatuses || {},
          })

          useSubBlockStore.setState((state: any) => ({
            workflowValues: {
              ...state.workflowValues,
              [workflowId]: subblockValues,
            },
          }))

          logger.info(`Successfully rehydrated stores from ${source}`)
          return true
        }

        socketInstance.on('copilot-workflow-edit', async (data) => {
          logger.info(
            `Copilot edited workflow ${data.workflowId} - rehydrating stores from database`
          )

          try {
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

        socketInstance.on('operation-confirmed', (data) => {
          logger.debug('Operation confirmed', { operationId: data.operationId })
          eventHandlers.current.operationConfirmed?.(data)
        })

        socketInstance.on('operation-failed', (data) => {
          logger.warn('Operation failed', { operationId: data.operationId, error: data.error })
          eventHandlers.current.operationFailed?.(data)
        })

        socketInstance.on('cursor-update', (data) => {
          setPresenceUsers((prev) => {
            const existingIndex = prev.findIndex((user) => user.socketId === data.socketId)
            if (existingIndex === -1) {
              logger.debug('Received cursor-update for unknown user', { socketId: data.socketId })
              return prev
            }
            return prev.map((user) =>
              user.socketId === data.socketId ? { ...user, cursor: data.cursor } : user
            )
          })
          eventHandlers.current.cursorUpdate?.(data)
        })

        socketInstance.on('selection-update', (data) => {
          setPresenceUsers((prev) => {
            const existingIndex = prev.findIndex((user) => user.socketId === data.socketId)
            if (existingIndex === -1) {
              logger.debug('Received selection-update for unknown user', {
                socketId: data.socketId,
              })
              return prev
            }
            return prev.map((user) =>
              user.socketId === data.socketId ? { ...user, selection: data.selection } : user
            )
          })
          eventHandlers.current.selectionUpdate?.(data)
        })

        socketInstance.on('error', (error) => {
          logger.error('Socket error:', error)
        })

        socketInstance.on('operation-error', (error) => {
          logger.error('Operation error:', error)
        })

        socketInstance.on('operation-forbidden', (error) => {
          logger.warn('Operation forbidden:', error)
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

    initializeSocket()

    return () => {
      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()
    }
  }, [user?.id, authFailed])

  useEffect(() => {
    if (!socket || !isConnected || !urlWorkflowId) return

    // Skip if already in the correct room
    if (currentWorkflowId === urlWorkflowId) return

    logger.info(
      `URL workflow changed from ${currentWorkflowId} to ${urlWorkflowId}, switching rooms`
    )

    if (currentWorkflowId) {
      logger.info(`Leaving current workflow ${currentWorkflowId} before joining ${urlWorkflowId}`)
      socket.emit('leave-workflow')
    }

    logger.info(`Joining workflow room: ${urlWorkflowId}`)
    socket.emit('join-workflow', {
      workflowId: urlWorkflowId,
      tabSessionId: getTabSessionId(),
    })
  }, [socket, isConnected, urlWorkflowId, currentWorkflowId])

  const joinWorkflow = useCallback(
    (workflowId: string) => {
      if (!socket || !user?.id) {
        logger.warn('Cannot join workflow: socket or user not available')
        return
      }

      if (currentWorkflowId === workflowId) {
        logger.info(`Already in workflow ${workflowId}, skipping join`)
        return
      }

      if (currentWorkflowId) {
        logger.info(`Leaving current workflow ${currentWorkflowId} before joining ${workflowId}`)
        socket.emit('leave-workflow')
      }

      logger.info(`Joining workflow: ${workflowId}`)
      socket.emit('join-workflow', {
        workflowId,
        tabSessionId: getTabSessionId(),
      })
      // currentWorkflowId will be set by join-workflow-success handler
    },
    [socket, user, currentWorkflowId]
  )

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

      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()
    }
  }, [socket, currentWorkflowId])

  /**
   * Retry socket connection after auth failure.
   * Call this when user has re-authenticated (e.g., after login redirect).
   */
  const retryConnection = useCallback(() => {
    if (!authFailed) {
      logger.info('retryConnection called but no auth failure - ignoring')
      return
    }
    logger.info('Retrying socket connection after auth failure')
    setAuthFailed(false)
    // initializedRef.current was already reset in connect_error handler
    // Effect will re-run and attempt connection
  }, [authFailed])

  const emitWorkflowOperation = useCallback(
    (operation: string, target: string, payload: any, operationId?: string) => {
      if (!socket || !currentWorkflowId) {
        return
      }

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
        socket.emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: Date.now(),
          operationId,
        })
      }
    },
    [socket, currentWorkflowId]
  )

  const emitSubblockUpdate = useCallback(
    (blockId: string, subblockId: string, value: any, operationId?: string) => {
      if (socket && currentWorkflowId) {
        socket.emit('subblock-update', {
          blockId,
          subblockId,
          value,
          timestamp: Date.now(),
          operationId,
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

  const emitVariableUpdate = useCallback(
    (variableId: string, field: string, value: any, operationId?: string) => {
      if (socket && currentWorkflowId) {
        socket.emit('variable-update', {
          variableId,
          field,
          value,
          timestamp: Date.now(),
          operationId,
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

      if (now - lastCursorEmit.current >= 33) {
        socket.emit('cursor-update', { cursor })
        lastCursorEmit.current = now
      }
    },
    [socket, currentWorkflowId]
  )

  const emitSelectionUpdate = useCallback(
    (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => {
      if (socket && currentWorkflowId) {
        socket.emit('selection-update', { selection })
      }
    },
    [socket, currentWorkflowId]
  )

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

  const contextValue = useMemo(
    () => ({
      socket,
      isConnected,
      isConnecting,
      authFailed,
      currentWorkflowId,
      currentSocketId,
      presenceUsers,
      joinWorkflow,
      leaveWorkflow,
      retryConnection,
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
      onWorkflowDeleted,
      onWorkflowReverted,
      onOperationConfirmed,
      onOperationFailed,
    }),
    [
      socket,
      isConnected,
      isConnecting,
      authFailed,
      currentWorkflowId,
      currentSocketId,
      presenceUsers,
      joinWorkflow,
      leaveWorkflow,
      retryConnection,
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
      onWorkflowDeleted,
      onWorkflowReverted,
      onOperationConfirmed,
      onOperationFailed,
    ]
  )

  return <SocketContext.Provider value={contextValue}>{children}</SocketContext.Provider>
}
