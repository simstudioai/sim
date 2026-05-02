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
import { generateId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import type { Socket } from 'socket.io-client'
import { getSocketUrl } from '@/lib/core/utils/urls'
import {
  type SocketJoinCommand,
  SocketJoinController,
} from '@/app/workspace/providers/socket-join-controller'
import {
  isSocketWorkflowVisible,
  resolveSocketWorkflowTarget,
} from '@/app/workspace/providers/socket-join-target'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useWorkflowRegistry as useWorkflowRegistryStore } from '@/stores/workflows/registry/store'

const logger = createLogger('SocketContext')

const TAB_SESSION_ID_KEY = 'sim_tab_session_id'

function getTabSessionId(): string {
  if (typeof window === 'undefined') return ''

  let tabSessionId = sessionStorage.getItem(TAB_SESSION_ID_KEY)
  if (!tabSessionId) {
    tabSessionId = generateId()
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
  isReconnecting: boolean
  isRetryingWorkflowJoin: boolean
  authFailed: boolean
  currentWorkflowId: string | null
  currentSocketId: string | null
  presenceUsers: PresenceUser[]
  joinWorkflow: (workflowId: string) => void
  leaveWorkflow: () => void
  retryConnection: () => void
  emitWorkflowOperation: (
    workflowId: string,
    operation: string,
    target: string,
    payload: any,
    operationId?: string
  ) => void
  emitSubblockUpdate: (
    blockId: string,
    subblockId: string,
    value: any,
    operationId: string | undefined,
    workflowId: string
  ) => void
  emitVariableUpdate: (
    variableId: string,
    field: string,
    value: any,
    operationId: string | undefined,
    workflowId: string
  ) => void

  emitCursorUpdate: (cursor: { x: number; y: number } | null) => void
  emitSelectionUpdate: (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => void
  onWorkflowOperation: (handler: (data: any) => void) => void
  onSubblockUpdate: (handler: (data: any) => void) => void
  onVariableUpdate: (handler: (data: any) => void) => void

  onCursorUpdate: (handler: (data: any) => void) => void
  onSelectionUpdate: (handler: (data: any) => void) => void
  onWorkflowDeleted: (handler: (data: any) => void) => void
  onWorkflowReverted: (handler: (data: any) => void) => void
  onWorkflowUpdated: (handler: (data: any) => void) => void
  onWorkflowDeployed: (handler: (data: any) => void) => void
  onOperationConfirmed: (handler: (data: any) => void) => void
  onOperationFailed: (handler: (data: any) => void) => void
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isConnecting: false,
  isReconnecting: false,
  isRetryingWorkflowJoin: false,
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
  onWorkflowUpdated: () => {},
  onWorkflowDeployed: () => {},
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
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isRetryingWorkflowJoin, setIsRetryingWorkflowJoin] = useState(false)
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null)
  const [currentSocketId, setCurrentSocketId] = useState<string | null>(null)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [authFailed, setAuthFailed] = useState(false)
  const [explicitWorkflowId, setExplicitWorkflowId] = useState<string | null>(null)
  const initializedRef = useRef(false)
  const socketRef = useRef<Socket | null>(null)
  const currentWorkflowIdRef = useRef<string | null>(null)
  const explicitWorkflowIdRef = useRef<string | null>(explicitWorkflowId)
  const joinControllerRef = useRef(new SocketJoinController())
  const joinRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const params = useParams()
  const urlWorkflowId = params?.workflowId as string | undefined
  const urlWorkflowIdRef = useRef(urlWorkflowId)
  urlWorkflowIdRef.current = urlWorkflowId
  explicitWorkflowIdRef.current = explicitWorkflowId

  const eventHandlers = useRef<{
    workflowOperation?: (data: any) => void
    subblockUpdate?: (data: any) => void
    variableUpdate?: (data: any) => void
    cursorUpdate?: (data: any) => void
    selectionUpdate?: (data: any) => void
    workflowDeleted?: (data: any) => void
    workflowReverted?: (data: any) => void
    workflowUpdated?: (data: any) => void
    workflowDeployed?: (data: any) => void
    operationConfirmed?: (data: any) => void
    operationFailed?: (data: any) => void
  }>({})

  const positionUpdateTimeouts = useRef<Map<string, number>>(new Map())
  const pendingPositionUpdates = useRef<Map<string, any>>(new Map())

  const setVisibleWorkflowId = useCallback((workflowId: string | null) => {
    currentWorkflowIdRef.current = workflowId
    setCurrentWorkflowId(workflowId)
  }, [])

  const getRequestedWorkflowId = useCallback(() => {
    return resolveSocketWorkflowTarget({
      routeWorkflowId: urlWorkflowIdRef.current ?? null,
      explicitWorkflowId: explicitWorkflowIdRef.current,
    })
  }, [])

  const isWorkflowVisible = useCallback((workflowId?: string | null) => {
    return isSocketWorkflowVisible({
      workflowId: workflowId ?? currentWorkflowIdRef.current,
      routeWorkflowId: urlWorkflowIdRef.current ?? null,
      explicitWorkflowId: explicitWorkflowIdRef.current,
    })
  }, [])

  const clearJoinRetryTimeout = useCallback(() => {
    if (joinRetryTimeoutRef.current !== null) {
      clearTimeout(joinRetryTimeoutRef.current)
      joinRetryTimeoutRef.current = null
    }
  }, [])

  const resetVisibleWorkflowState = useCallback((workflowId?: string | null) => {
    if (workflowId) {
      useOperationQueueStore.getState().cancelOperationsForWorkflow(workflowId)
    }

    positionUpdateTimeouts.current.forEach((timeoutId) => {
      clearTimeout(timeoutId)
    })
    positionUpdateTimeouts.current.clear()
    pendingPositionUpdates.current.clear()
  }, [])

  const clearJoinedWorkflowState = useCallback(
    (cancelOperations = false) => {
      const previousWorkflowId = currentWorkflowIdRef.current
      resetVisibleWorkflowState(cancelOperations ? previousWorkflowId : null)
      setPresenceUsers([])
      setVisibleWorkflowId(null)
    },
    [resetVisibleWorkflowState, setVisibleWorkflowId]
  )

  const executeJoinCommands = useCallback(
    (commands: SocketJoinCommand[]) => {
      const socketInstance = socketRef.current

      commands.forEach((command) => {
        if (command.type === 'cancel-retry') {
          clearJoinRetryTimeout()
          setIsRetryingWorkflowJoin(false)
          return
        }

        if (command.type === 'leave') {
          setIsRetryingWorkflowJoin(false)
          clearJoinedWorkflowState(true)

          if (!socketInstance) {
            return
          }

          logger.info('Leaving current workflow room')
          socketInstance.emit('leave-workflow')
          return
        }

        if (command.type === 'join') {
          const isWorkflowSwitch =
            currentWorkflowIdRef.current !== null &&
            currentWorkflowIdRef.current !== command.workflowId

          if (isWorkflowSwitch) {
            resetVisibleWorkflowState(currentWorkflowIdRef.current)
          } else {
            resetVisibleWorkflowState()
          }

          if (!socketInstance) {
            logger.warn('Cannot join workflow room: socket not available', {
              workflowId: command.workflowId,
            })
            return
          }

          logger.info(`Joining workflow room: ${command.workflowId}`)
          socketInstance.emit('join-workflow', {
            workflowId: command.workflowId,
            tabSessionId: getTabSessionId(),
          })
          return
        }

        clearJoinRetryTimeout()
        setIsRetryingWorkflowJoin(true)
        joinRetryTimeoutRef.current = setTimeout(() => {
          joinRetryTimeoutRef.current = null
          executeJoinCommands(joinControllerRef.current.retryJoin(command.workflowId))
        }, command.delayMs)

        logger.warn('Realtime unavailable while joining workflow, scheduling retry', {
          workflowId: command.workflowId,
          attempt: command.attempt,
          delayMs: command.delayMs,
        })
      })
    },
    [clearJoinRetryTimeout, clearJoinedWorkflowState, resetVisibleWorkflowState]
  )

  const generateSocketToken = async (): Promise<string> => {
    // boundary-raw-fetch: pre-bootstrap one-time socket token mint — Better Auth's
    // generateOneTimeToken handler (in INDIRECT_ZOD_ROUTES baseline) has no client
    // contract; called from Socket.IO auth callback before any contract-bound client.
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

    const initializeSocket = async () => {
      try {
        const { io } = await import('socket.io-client')
        const socketUrl = getSocketUrl()

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
              if (error instanceof Error && error.message === 'Authentication required') {
                // True auth failure - pass null token, server will reject with "Authentication required"
                cb({ token: null })
              }
              // For server errors, don't call cb - connection will timeout and Socket.IO will retry
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
          executeJoinCommands(joinControllerRef.current.setConnected(true))
        })

        socketInstance.on('disconnect', (reason) => {
          setIsConnected(false)
          setIsConnecting(false)
          setIsRetryingWorkflowJoin(false)
          setCurrentSocketId(null)
          executeJoinCommands(joinControllerRef.current.setConnected(false))
          clearJoinedWorkflowState(false)

          if (socketInstance.active) {
            setIsReconnecting(true)
            logger.info('Socket disconnected, will auto-reconnect', { reason })
          } else {
            setIsReconnecting(false)
            logger.info('Socket disconnected, no auto-reconnect', { reason })
          }
        })

        socketInstance.on('connect_error', (error: Error) => {
          setIsConnecting(false)
          logger.error('Socket connection error:', { message: error.message })

          // Check if this is an authentication failure
          const isAuthError =
            error.message?.includes('Token validation failed') ||
            error.message?.includes('Authentication failed') ||
            error.message?.includes('Authentication required')

          if (isAuthError) {
            logger.warn(
              'Authentication failed - stopping reconnection attempts. User may need to refresh/re-login.'
            )
            socketInstance.disconnect()
            setSocket(null)
            setAuthFailed(true)
            setIsReconnecting(false)
            initializedRef.current = false
          } else if (socketInstance.active) {
            // Temporary failure, will auto-reconnect
            setIsReconnecting(true)
          }
        })

        // Reconnection events are on the Manager (socket.io), not the socket itself
        socketInstance.io.on('reconnect', (attemptNumber) => {
          setIsConnected(true)
          setIsReconnecting(false)
          setCurrentSocketId(socketInstance.id ?? null)
          logger.info('Socket reconnected successfully', {
            attemptNumber,
            socketId: socketInstance.id,
            transport: socketInstance.io.engine?.transport?.name,
          })
        })

        socketInstance.io.on('reconnect_attempt', (attemptNumber) => {
          setIsReconnecting(true)
          logger.info('Socket reconnection attempt', { attemptNumber })
        })

        socketInstance.io.on('reconnect_error', (error: Error) => {
          logger.error('Socket reconnection error:', { message: error.message })
        })

        socketInstance.io.on('reconnect_failed', () => {
          logger.error('Socket reconnection failed - all attempts exhausted')
          setIsReconnecting(false)
          setIsConnecting(false)
        })

        socketInstance.on('presence-update', (users: PresenceUser[]) => {
          if (!isWorkflowVisible()) {
            return
          }

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

        socketInstance.on('join-workflow-success', ({ workflowId, presenceUsers }) => {
          const result = joinControllerRef.current.handleJoinSuccess(workflowId)

          if (result.ignored) {
            logger.debug(`Ignoring stale join-workflow-success for ${workflowId}`)
          } else {
            setIsRetryingWorkflowJoin(false)
            setVisibleWorkflowId(workflowId)
            setPresenceUsers(presenceUsers || [])
            logger.info(`Successfully joined workflow room: ${workflowId}`, {
              presenceCount: presenceUsers?.length || 0,
            })
          }

          executeJoinCommands(result.commands)
        })

        socketInstance.on('join-workflow-error', ({ workflowId, error, code, retryable }) => {
          const result = joinControllerRef.current.handleJoinError({ workflowId, retryable })

          if (result.ignored) {
            logger.debug('Ignoring stale join-workflow-error', {
              workflowId: result.workflowId,
              error,
              code,
            })
          } else if (result.retryScheduled) {
            logger.warn('Retryable workflow join failure, waiting to retry', {
              workflowId: result.workflowId,
              error,
              code,
            })
          } else if (result.apply) {
            setIsRetryingWorkflowJoin(false)
            if (result.workflowId) {
              useOperationQueueStore.getState().cancelOperationsForWorkflow(result.workflowId)
            }

            logger.error('Failed to join workflow:', {
              workflowId: result.workflowId,
              error,
              code,
            })
          }

          executeJoinCommands(result.commands)
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
          const result = joinControllerRef.current.handleWorkflowDeleted(data.workflowId)
          if (result.shouldClearCurrent) {
            clearJoinedWorkflowState(true)
          }
          executeJoinCommands(result.commands)
          eventHandlers.current.workflowDeleted?.(data)
        })

        socketInstance.on('workflow-reverted', (data) => {
          logger.info(`Workflow ${data.workflowId} has been reverted to deployed state`)
          eventHandlers.current.workflowReverted?.(data)
        })

        socketInstance.on('workflow-updated', (data) => {
          logger.info(`Workflow ${data.workflowId} has been updated externally`)
          eventHandlers.current.workflowUpdated?.(data)
        })

        socketInstance.on('workflow-deployed', (data) => {
          logger.info(`Workflow ${data.workflowId} deployment state changed`)
          eventHandlers.current.workflowDeployed?.(data)
        })

        const rehydrateWorkflowStores = async (workflowId: string, workflowState: any) => {
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

          const { activeWorkflowId } = useWorkflowRegistry.getState()
          if (activeWorkflowId !== workflowId) {
            logger.info(`Skipping rehydration - workflow ${workflowId} is not active`)
            return false
          }

          const hasPending = useOperationQueueStore
            .getState()
            .operations.some((op: any) => op.workflowId === workflowId && op.status !== 'confirmed')
          if (hasPending) {
            logger.info('Skipping rehydration due to pending operations in queue')
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
          })

          useSubBlockStore.setState((state: any) => ({
            workflowValues: {
              ...state.workflowValues,
              [workflowId]: subblockValues,
            },
          }))

          logger.info('Successfully rehydrated workflow stores')
          return true
        }

        socketInstance.on('operation-confirmed', (data) => {
          logger.debug('Operation confirmed', { operationId: data.operationId })
          eventHandlers.current.operationConfirmed?.(data)
        })

        socketInstance.on('operation-failed', (data) => {
          logger.warn('Operation failed', { operationId: data.operationId, error: data.error })
          eventHandlers.current.operationFailed?.(data)
        })

        socketInstance.on('cursor-update', (data) => {
          if (!isWorkflowVisible()) {
            return
          }

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
          if (!isWorkflowVisible()) {
            return
          }

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

          if (error?.type === 'SESSION_ERROR') {
            const workflowId = getRequestedWorkflowId()

            if (workflowId) {
              logger.info(`Session expired, rejoining workflow: ${workflowId}`)
              executeJoinCommands(joinControllerRef.current.forceRejoinWorkflow(workflowId))
            }
          }
        })

        socketInstance.on('workflow-state', async (workflowData) => {
          logger.info('Received workflow state from server')

          if (
            !workflowData?.id ||
            currentWorkflowIdRef.current !== workflowData.id ||
            !isWorkflowVisible()
          ) {
            logger.info('Ignoring workflow state for inactive room', {
              workflowId: workflowData?.id,
              currentWorkflowId: currentWorkflowIdRef.current,
              desiredWorkflowId: urlWorkflowIdRef.current,
            })
            return
          }

          if (workflowData?.state) {
            try {
              await rehydrateWorkflowStores(workflowData.id, workflowData.state)
            } catch (error) {
              logger.error('Error rehydrating workflow state:', error)
            }
          }
        })

        socketRef.current = socketInstance
        setSocket(socketInstance)
      } catch (error) {
        logger.error('Failed to initialize socket with token:', error)
        setIsConnecting(false)
      }
    }

    initializeSocket()

    return () => {
      clearJoinRetryTimeout()
      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()

      // Close socket on unmount
      if (socketRef.current) {
        logger.info('Closing socket connection on unmount')
        socketRef.current.close()
        socketRef.current = null
      }
    }
  }, [user?.id, authFailed])

  const hydrationPhase = useWorkflowRegistryStore((s) => s.hydration.phase)

  useEffect(() => {
    if (hydrationPhase === 'creating') {
      return
    }

    executeJoinCommands(joinControllerRef.current.requestWorkflow(getRequestedWorkflowId()))
  }, [
    explicitWorkflowId,
    getRequestedWorkflowId,
    hydrationPhase,
    urlWorkflowId,
    executeJoinCommands,
  ])

  const joinWorkflow = useCallback(
    (workflowId: string) => {
      if (!user?.id) {
        logger.warn('Cannot join workflow: user not available')
        return
      }

      setExplicitWorkflowId(workflowId)
    },
    [user]
  )

  const leaveWorkflow = useCallback(() => {
    setExplicitWorkflowId(null)
  }, [])

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
    (workflowId: string, operation: string, target: string, payload: any, operationId?: string) => {
      if (
        !socket ||
        !currentWorkflowId ||
        workflowId !== currentWorkflowId ||
        !isWorkflowVisible(workflowId)
      ) {
        logger.debug('Skipping workflow operation emit for inactive room', {
          workflowId,
          currentWorkflowId,
          desiredWorkflowId: urlWorkflowIdRef.current,
          operation,
          target,
        })
        return
      }

      const isPositionUpdate = operation === 'update-position' && target === 'block'
      const { commit = true } = payload || {}

      if (isPositionUpdate && payload.id) {
        const blockId = payload.id

        if (commit) {
          socket.emit('workflow-operation', {
            workflowId,
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
          workflowId,
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
          workflowId,
          operation,
          target,
          payload,
          timestamp: Date.now(),
          operationId,
        })
      }
    },
    [socket, currentWorkflowId, isWorkflowVisible]
  )

  const emitSubblockUpdate = useCallback(
    (
      blockId: string,
      subblockId: string,
      value: any,
      operationId: string | undefined,
      workflowId: string
    ) => {
      if (
        !socket ||
        workflowId !== currentWorkflowIdRef.current ||
        !isWorkflowVisible(workflowId)
      ) {
        const reason = !socket
          ? 'socket_unavailable'
          : workflowId !== currentWorkflowIdRef.current
            ? 'joined_workflow_mismatch'
            : 'workflow_not_visible'

        logger.debug('Skipping subblock update emit', {
          workflowId,
          blockId,
          subblockId,
          reason,
          currentWorkflowId: currentWorkflowIdRef.current,
        })
        return
      }
      socket.emit('subblock-update', {
        workflowId,
        blockId,
        subblockId,
        value,
        timestamp: Date.now(),
        operationId,
      })
    },
    [socket]
  )

  const emitVariableUpdate = useCallback(
    (
      variableId: string,
      field: string,
      value: any,
      operationId: string | undefined,
      workflowId: string
    ) => {
      if (
        !socket ||
        workflowId !== currentWorkflowIdRef.current ||
        !isWorkflowVisible(workflowId)
      ) {
        const reason = !socket
          ? 'socket_unavailable'
          : workflowId !== currentWorkflowIdRef.current
            ? 'joined_workflow_mismatch'
            : 'workflow_not_visible'

        logger.debug('Skipping variable update emit', {
          workflowId,
          variableId,
          field,
          reason,
          currentWorkflowId: currentWorkflowIdRef.current,
        })
        return
      }
      socket.emit('variable-update', {
        workflowId,
        variableId,
        field,
        value,
        timestamp: Date.now(),
        operationId,
      })
    },
    [socket]
  )

  const lastCursorEmit = useRef(0)
  const emitCursorUpdate = useCallback(
    (cursor: { x: number; y: number } | null) => {
      if (!socket || !currentWorkflowId || !isWorkflowVisible(currentWorkflowId)) {
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
    [socket, currentWorkflowId, isWorkflowVisible]
  )

  const emitSelectionUpdate = useCallback(
    (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => {
      if (socket && currentWorkflowId && isWorkflowVisible(currentWorkflowId)) {
        socket.emit('selection-update', { selection })
      }
    },
    [socket, currentWorkflowId, isWorkflowVisible]
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

  const onWorkflowUpdated = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowUpdated = handler
  }, [])

  const onWorkflowDeployed = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowDeployed = handler
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
      isReconnecting,
      isRetryingWorkflowJoin,
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
      onWorkflowUpdated,
      onWorkflowDeployed,
      onOperationConfirmed,
      onOperationFailed,
    }),
    [
      socket,
      isConnected,
      isConnecting,
      isReconnecting,
      isRetryingWorkflowJoin,
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
      onWorkflowUpdated,
      onWorkflowDeployed,
      onOperationConfirmed,
      onOperationFailed,
    ]
  )

  return <SocketContext.Provider value={contextValue}>{children}</SocketContext.Provider>
}
