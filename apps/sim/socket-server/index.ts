import { createServer } from 'http'
import { getSessionCookie } from 'better-auth/cookies'
import { Server, type Socket } from 'socket.io'

// Extend Socket interface to include user data
interface AuthenticatedSocket extends Socket {
  userId?: string
  userName?: string
  userEmail?: string
  activeOrganizationId?: string
}

import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import {
  workflow,
  workflowBlocks,
  workflowEdges,
  workflowSubflows,
  workspaceMember,
} from '../db/schema'
import { auth } from '../lib/auth'
import { createLogger } from '../lib/logs/console-logger'

const logger = createLogger('CollaborativeSocketServer')

// Enhanced server configuration
const httpServer = createServer((req, res) => {
  // Handle health check for Railway
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        connections: Array.from(workflowRooms.values()).reduce(
          (total, room) => total + room.activeConnections,
          0
        ),
      })
    )
    return
  }

  // Handle workflow deletion notifications from the main API
  if (req.method === 'POST' && req.url === '/api/workflow-deleted') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        const { workflowId } = JSON.parse(body)
        handleWorkflowDeletion(workflowId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (error) {
        logger.error('Error handling workflow deletion notification:', error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to process deletion notification' }))
      }
    })
    return
  }

  // Default response for other requests
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

// Configure allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.VERCEL_URL, 
  'http://localhost:3000',
  'http://localhost:3001',
  ...(process.env.ALLOWED_ORIGINS?.split(',') || [])
].filter((url): url is string => Boolean(url))

logger.info('Socket.IO CORS configuration:', { allowedOrigins })

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'socket.io'],
    credentials: true, // Enable credentials to accept cookies
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
  cookie: false,
})

// Enhanced connection and presence tracking
interface UserPresence {
  userId: string
  workflowId: string
  userName: string
  socketId: string
  joinedAt: number
  lastActivity: number
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

interface WorkflowRoom {
  workflowId: string
  users: Map<string, UserPresence> // socketId -> UserPresence
  lastModified: number
  activeConnections: number
}

// Global state management
const workflowRooms = new Map<string, WorkflowRoom>() // workflowId -> WorkflowRoom
const socketToWorkflow = new Map<string, string>() // socketId -> workflowId
const userSessions = new Map<string, { userId: string; userName: string }>() // socketId -> session

// Enhanced database operation queue for batching and performance
const pendingDbOperations = new Map<string, any[]>() // workflowId -> operations[]
const batchTimeouts = new Map<string, NodeJS.Timeout>() // workflowId -> timeout
const BATCH_DELAY = 100 // ms - batch operations within 100ms window
const MAX_BATCH_SIZE = 50 // Maximum operations per batch

// Validation schemas for workflow operations
const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const BlockOperationSchema = z.object({
  operation: z.enum([
    'add',
    'remove',
    'update-position',
    'update-name',
    'toggle-enabled',
    'update-parent',
    'duplicate',
  ]),
  target: z.literal('block'),
  payload: z.object({
    id: z.string(),
    type: z.string().optional(),
    name: z.string().optional(),
    position: PositionSchema.optional(),
    data: z.record(z.any()).optional(),
    parentId: z.string().optional(),
    extent: z.enum(['parent']).optional(),
    enabled: z.boolean().optional(),
  }),
  timestamp: z.number(),
})

const EdgeOperationSchema = z.object({
  operation: z.enum(['add', 'remove']),
  target: z.literal('edge'),
  payload: z.object({
    id: z.string(),
    source: z.string().optional(),
    target: z.string().optional(),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
  }),
  timestamp: z.number(),
})

// Constants
const DEFAULT_LOOP_ITERATIONS = 5

// Enum for subflow types
enum SubflowType {
  LOOP = 'loop',
  PARALLEL = 'parallel',
}

// Helper function to check if a block type is a subflow type
function isSubflowBlockType(blockType: string): blockType is SubflowType {
  return Object.values(SubflowType).includes(blockType as SubflowType)
}

// Helper function to update subflow node lists when child blocks are added/removed
async function updateSubflowNodeList(dbOrTx: any, workflowId: string, parentId: string) {
  try {
    // Get all child blocks of this parent
    const childBlocks = await dbOrTx
      .select({ id: workflowBlocks.id })
      .from(workflowBlocks)
      .where(and(eq(workflowBlocks.workflowId, workflowId), eq(workflowBlocks.parentId, parentId)))

    const childNodeIds = childBlocks.map((block) => block.id)

    // Get current subflow config
    const subflowData = await dbOrTx
      .select({ config: workflowSubflows.config })
      .from(workflowSubflows)
      .where(and(eq(workflowSubflows.id, parentId), eq(workflowSubflows.workflowId, workflowId)))
      .limit(1)

    if (subflowData.length > 0) {
      const updatedConfig = {
        ...subflowData[0].config,
        nodes: childNodeIds,
      }

      await dbOrTx
        .update(workflowSubflows)
        .set({
          config: updatedConfig,
          updatedAt: new Date(),
        })
        .where(and(eq(workflowSubflows.id, parentId), eq(workflowSubflows.workflowId, workflowId)))

      logger.debug(`Updated subflow ${parentId} node list: [${childNodeIds.join(', ')}]`)
    }
  } catch (error) {
    logger.error(`Error updating subflow node list for ${parentId}:`, error)
  }
}

const SubflowOperationSchema = z.object({
  operation: z.enum(['add', 'remove', 'update']),
  target: z.literal('subflow'),
  payload: z.object({
    id: z.string(),
    type: z.enum(['loop', 'parallel']).optional(),
    config: z.record(z.any()).optional(),
  }),
  timestamp: z.number(),
})

const WorkflowOperationSchema = z.union([
  BlockOperationSchema,
  EdgeOperationSchema,
  SubflowOperationSchema,
])

// Simplified conflict resolution - just last-write-wins since we have normalized tables
function shouldAcceptOperation(operation: any, roomLastModified: number): boolean {
  // Accept all operations - with normalized tables, conflicts are very unlikely
  // We could add basic timestamp validation if needed, but for now just accept everything
  return true
}

// Enhanced authentication middleware
async function authenticateSocket(socket: AuthenticatedSocket, next: any) {
  try {
    // Extract session from socket handshake
    const cookies = socket.handshake.headers.cookie
    logger.info(`Socket ${socket.id} handshake headers:`, {
      cookie: cookies,
      allHeaders: Object.keys(socket.handshake.headers),
    })

    if (!cookies) {
      logger.warn(`Socket ${socket.id} rejected: No cookies found`)
      return next(new Error('Authentication required'))
    }

    // Create a mock request object to use Better Auth's cookie utility
    const mockRequest = {
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'cookie') {
            return cookies
          }
          return null
        },
      },
    } as any

    // Use Better Auth's utility to get the session cookie
    const sessionCookie = getSessionCookie(mockRequest)
    if (!sessionCookie) {
      logger.warn(`Socket ${socket.id} rejected: No session cookie found`)
      return next(new Error('Authentication required'))
    }

    // Validate session with better-auth
    try {
      // Create a mock request object for better-auth
      const mockHeaders = new Headers()
      mockHeaders.set('cookie', cookies)

      const session = await auth.api.getSession({
        headers: mockHeaders,
      })

      if (!session?.user?.id) {
        logger.warn(`Socket ${socket.id} rejected: Invalid session`)
        return next(new Error('Invalid session'))
      }

      // Store user info in socket for later use
      socket.userId = session.user.id
      socket.userName = session.user.name || session.user.email || 'Unknown User'
      socket.userEmail = session.user.email
      socket.activeOrganizationId = session.session.activeOrganizationId || undefined

      logger.info(`✅ Socket.IO user authenticated: ${socket.id}`, {
        userId: session.user.id,
        userName: socket.userName,
        organizationId: socket.activeOrganizationId,
      })
      next()
    } catch (sessionError) {
      logger.warn(`Session validation failed for socket ${socket.id}:`, sessionError)
      return next(new Error('Session validation failed'))
    }
  } catch (error) {
    logger.error(`Socket authentication error for ${socket.id}:`, error)
    next(new Error('Authentication failed'))
  }
}

// Apply authentication middleware
io.use(authenticateSocket)

// Utility functions
async function verifyWorkspaceMembership(
  userId: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const membership = await db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
      .limit(1)

    return membership.length > 0 ? membership[0].role : null
  } catch (error) {
    logger.error(`Error verifying workspace membership for ${userId} in ${workspaceId}:`, error)
    return null
  }
}
async function verifyWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{ hasAccess: boolean; role?: string; workspaceId?: string }> {
  try {
    const workflowData = await db
      .select({
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
        name: workflow.name,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData.length) {
      logger.warn(`Workflow ${workflowId} not found`)
      return { hasAccess: false }
    }

    const { userId: workflowUserId, workspaceId, name: workflowName } = workflowData[0]

    // Check if user owns the workflow
    if (workflowUserId === userId) {
      logger.debug(`User ${userId} has owner access to workflow ${workflowId} (${workflowName})`)
      return { hasAccess: true, role: 'owner', workspaceId: workspaceId || undefined }
    }

    // Check workspace membership if workflow belongs to a workspace
    if (workspaceId) {
      const userRole = await verifyWorkspaceMembership(userId, workspaceId)
      if (userRole) {
        logger.debug(
          `User ${userId} has ${userRole} access to workflow ${workflowId} via workspace ${workspaceId}`
        )
        return { hasAccess: true, role: userRole, workspaceId }
      }
      logger.warn(
        `User ${userId} is not a member of workspace ${workspaceId} for workflow ${workflowId}`
      )
      return { hasAccess: false }
    }

    // Workflow doesn't belong to a workspace and user doesn't own it
    logger.warn(`User ${userId} has no access to workflow ${workflowId} (no workspace, not owner)`)
    return { hasAccess: false }
  } catch (error) {
    logger.error(
      `Error verifying workflow access for user ${userId}, workflow ${workflowId}:`,
      error
    )
    return { hasAccess: false }
  }
}

// Enhanced authorization for specific operations
async function verifyOperationPermission(
  userId: string,
  workflowId: string,
  operation: string,
  target: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const accessInfo = await verifyWorkflowAccess(userId, workflowId)

    if (!accessInfo.hasAccess) {
      return { allowed: false, reason: 'No access to workflow' }
    }

    // Define operation permissions based on role
    const rolePermissions = {
      owner: [
        'add',
        'remove',
        'update',
        'update-position',
        'update-name',
        'toggle-enabled',
        'update-parent',
        'duplicate',
      ],
      admin: [
        'add',
        'remove',
        'update',
        'update-position',
        'update-name',
        'toggle-enabled',
        'update-parent',
        'duplicate',
      ],
      member: [
        'add',
        'remove',
        'update',
        'update-position',
        'update-name',
        'toggle-enabled',
        'update-parent',
        'duplicate',
      ],
      viewer: ['update-position'], // Viewers can only move things around
    }

    const allowedOperations = rolePermissions[accessInfo.role as keyof typeof rolePermissions] || []

    if (!allowedOperations.includes(operation)) {
      return {
        allowed: false,
        reason: `Role '${accessInfo.role}' not permitted to perform '${operation}' on '${target}'`,
      }
    }

    return { allowed: true }
  } catch (error) {
    logger.error(`Error verifying operation permission:`, error)
    return { allowed: false, reason: 'Permission check failed' }
  }
}

function createWorkflowRoom(workflowId: string): WorkflowRoom {
  return {
    workflowId,
    users: new Map(),
    lastModified: Date.now(),
    activeConnections: 0,
  }
}

function cleanupUserFromRoom(socketId: string, workflowId: string) {
  const room = workflowRooms.get(workflowId)
  if (room) {
    room.users.delete(socketId)
    room.activeConnections = Math.max(0, room.activeConnections - 1)

    if (room.activeConnections === 0) {
      workflowRooms.delete(workflowId)
      logger.info(`Cleaned up empty workflow room: ${workflowId}`)
    }
  }

  socketToWorkflow.delete(socketId)
  userSessions.delete(socketId)
}

function clearPendingOperations(socketId: string) {
  // Clear any pending operations for this socket
  // This would be used if we implement operation queuing
  logger.debug(`Cleared pending operations for socket ${socketId}`)
}

// Handle workflow deletion notifications
function handleWorkflowDeletion(workflowId: string) {
  logger.info(`Handling workflow deletion notification for ${workflowId}`)

  const room = workflowRooms.get(workflowId)
  if (!room) {
    logger.debug(`No active room found for deleted workflow ${workflowId}`)
    return
  }

  // Notify all users in the room that the workflow has been deleted
  io.to(workflowId).emit('workflow-deleted', {
    workflowId,
    message: 'This workflow has been deleted',
    timestamp: Date.now(),
  })

  // Disconnect all sockets from the workflow room
  const socketsToDisconnect: string[] = []
  room.users.forEach((presence, socketId) => {
    socketsToDisconnect.push(socketId)
  })

  // Clean up each socket connection
  socketsToDisconnect.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId)
    if (socket) {
      socket.leave(workflowId)
      logger.debug(`Disconnected socket ${socketId} from deleted workflow ${workflowId}`)
    }
    cleanupUserFromRoom(socketId, workflowId)
  })

  // Clean up the room completely
  workflowRooms.delete(workflowId)
  logger.info(
    `Cleaned up workflow room ${workflowId} after deletion (${socketsToDisconnect.length} users disconnected)`
  )
}

// Database helper functions
async function getWorkflowState(workflowId: string) {
  try {
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData.length) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    return {
      ...workflowData[0],
      lastModified: Date.now(),
    }
  } catch (error) {
    logger.error(`Error fetching workflow state for ${workflowId}:`, error)
    throw error
  }
}

async function persistWorkflowOperation(workflowId: string, operation: any) {
  // Use database transaction for consistency
  try {
    const { operation: op, target, payload, timestamp, userId } = operation

    await db.transaction(async (tx) => {
      // Update the workflow's last modified timestamp first
      await tx
        .update(workflow)
        .set({ updatedAt: new Date(timestamp) })
        .where(eq(workflow.id, workflowId))

      // Handle different operation types within the transaction
      switch (target) {
        case 'block':
          await handleBlockOperationTx(tx, workflowId, op, payload, userId)
          break
        case 'edge':
          await handleEdgeOperationTx(tx, workflowId, op, payload, userId)
          break
        case 'subflow':
          await handleSubflowOperationTx(tx, workflowId, op, payload, userId)
          break
        default:
          throw new Error(`Unknown operation target: ${target}`)
      }
    })

    logger.debug(`✅ Persisted ${op} operation on ${target} for workflow ${workflowId}`)
  } catch (error) {
    logger.error(
      `❌ Error persisting workflow operation (${operation.operation} on ${operation.target}):`,
      error
    )
    throw error
  }
}

// Add data consistency validation
async function validateWorkflowConsistency(
  workflowId: string
): Promise<{ valid: boolean; issues: string[] }> {
  try {
    const issues: string[] = []

    // Check for orphaned edges (edges pointing to non-existent blocks)
    const orphanedEdges = await db
      .select({
        id: workflowEdges.id,
        sourceBlockId: workflowEdges.sourceBlockId,
        targetBlockId: workflowEdges.targetBlockId,
      })
      .from(workflowEdges)
      .leftJoin(workflowBlocks, eq(workflowEdges.sourceBlockId, workflowBlocks.id))
      .where(
        and(
          eq(workflowEdges.workflowId, workflowId),
          isNull(workflowBlocks.id) // Source block doesn't exist
        )
      )

    if (orphanedEdges.length > 0) {
      issues.push(`Found ${orphanedEdges.length} orphaned edges with missing source blocks`)
    }

    // Could add more consistency checks here as needed

    return { valid: issues.length === 0, issues }
  } catch (error) {
    logger.error('Error validating workflow consistency:', error)
    return { valid: false, issues: ['Consistency check failed'] }
  }
}

// Transaction-based operation handlers for data consistency
async function handleBlockOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  return handleBlockOperationImpl(tx, workflowId, operation, payload, userId)
}

async function handleEdgeOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  return handleEdgeOperationImpl(tx, workflowId, operation, payload, userId)
}

async function handleSubflowOperationTx(
  tx: any,
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  return handleSubflowOperationImpl(tx, workflowId, operation, payload, userId)
}

// Implementation functions that work with both db and transaction
async function handleEdgeOperationImpl(
  dbOrTx: any,
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  // Move the existing handleEdgeOperation logic here
  return handleEdgeOperation(workflowId, operation, payload, userId)
}

async function handleSubflowOperationImpl(
  dbOrTx: any,
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  try {
    switch (operation) {
      case 'add':
        // Validate required fields
        if (!payload.id || !payload.type || !payload.config) {
          throw new Error('Missing required fields for add subflow operation')
        }

        // Validate subflow type
        if (!['loop', 'parallel'].includes(payload.type)) {
          throw new Error(`Invalid subflow type: ${payload.type}`)
        }

        // Validate config structure based on type
        if (payload.type === 'loop') {
          if (!payload.config.nodes || !Array.isArray(payload.config.nodes)) {
            throw new Error('Loop subflow requires nodes array in config')
          }
          if (!payload.config.loopType || !['for', 'forEach'].includes(payload.config.loopType)) {
            throw new Error('Loop subflow requires valid loopType (for or forEach)')
          }
        } else if (payload.type === 'parallel') {
          if (!payload.config.nodes || !Array.isArray(payload.config.nodes)) {
            throw new Error('Parallel subflow requires nodes array in config')
          }
        }

        await dbOrTx.insert(workflowSubflows).values({
          id: payload.id,
          workflowId,
          type: payload.type,
          config: payload.config,
        })

        logger.debug(`Added ${payload.type} subflow ${payload.id} to workflow ${workflowId}`)
        break

      case 'update': {
        if (!payload.id || !payload.config) {
          throw new Error('Missing required fields for update subflow operation')
        }

        logger.debug(`[SERVER] Updating subflow ${payload.id} with config:`, payload.config)

        // Update the subflow configuration
        const updateResult = await dbOrTx
          .update(workflowSubflows)
          .set({
            config: payload.config,
            updatedAt: new Date(),
          })
          .where(
            and(eq(workflowSubflows.id, payload.id), eq(workflowSubflows.workflowId, workflowId))
          )
          .returning({ id: workflowSubflows.id })

        if (updateResult.length === 0) {
          throw new Error(`Subflow ${payload.id} not found in workflow ${workflowId}`)
        }

        // Also update the corresponding block's data to keep UI in sync
        if (payload.type === 'loop' && payload.config.iterations !== undefined) {
          // Update the loop block's data.count property
          await dbOrTx
            .update(workflowBlocks)
            .set({
              data: {
                ...payload.config,
                count: payload.config.iterations,
                loopType: payload.config.loopType,
                collection: payload.config.forEachItems,
                width: 500,
                height: 300,
                type: 'loopNode',
              },
              updatedAt: new Date(),
            })
            .where(
              and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId))
            )

          logger.debug(
            `[SERVER] ✅ Also updated loop block ${payload.id} data.count = ${payload.config.iterations}`
          )
        } else if (payload.type === 'parallel') {
          // Update the parallel block's data properties
          const blockData = {
            ...payload.config,
            width: 500,
            height: 300,
            type: 'parallelNode',
          }

          // Include count if provided
          if (payload.config.count !== undefined) {
            blockData.count = payload.config.count
          }

          // Include collection if provided
          if (payload.config.distribution !== undefined) {
            blockData.collection = payload.config.distribution
          }

          await dbOrTx
            .update(workflowBlocks)
            .set({
              data: blockData,
              updatedAt: new Date(),
            })
            .where(
              and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId))
            )

          logger.debug(`[SERVER] ✅ Also updated parallel block ${payload.id} data:`, {
            count: payload.config.count,
            collection: payload.config.distribution,
          })
        }

        logger.debug(
          `[SERVER] ✅ Successfully updated subflow ${payload.id} in workflow ${workflowId}`
        )
        break
      }

      case 'remove': {
        if (!payload.id) {
          throw new Error('Missing subflow ID for remove operation')
        }

        const deleteResult = await dbOrTx
          .delete(workflowSubflows)
          .where(
            and(eq(workflowSubflows.id, payload.id), eq(workflowSubflows.workflowId, workflowId))
          )
          .returning({ id: workflowSubflows.id })

        if (deleteResult.length === 0) {
          throw new Error(`Subflow ${payload.id} not found in workflow ${workflowId}`)
        }

        logger.debug(`Removed subflow ${payload.id} from workflow ${workflowId}`)
        break
      }

      default:
        logger.warn(`Unknown subflow operation: ${operation}`)
        throw new Error(`Unsupported subflow operation: ${operation}`)
    }
  } catch (error) {
    logger.error(`Error in handleSubflowOperation (${operation}):`, error)
    throw error
  }
}

// Enhanced operation handlers with comprehensive validation
async function handleBlockOperation(
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  return handleBlockOperationImpl(db, workflowId, operation, payload, userId)
}

async function handleBlockOperationImpl(
  dbOrTx: any,
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  try {
    switch (operation) {
      case 'add': {
        // Validate required fields for add operation
        if (!payload.id || !payload.type || !payload.name || !payload.position) {
          throw new Error('Missing required fields for add block operation')
        }

        logger.debug(`[SERVER] Adding block: ${payload.type} (${payload.id})`, {
          isSubflowType: isSubflowBlockType(payload.type),
          payload,
        })

        // Extract parentId and extent from payload.data if they exist there, otherwise from payload directly
        const parentId = payload.parentId || payload.data?.parentId || null
        const extent = payload.extent || payload.data?.extent || null

        logger.debug(`[SERVER] Block parent info:`, {
          blockId: payload.id,
          hasParent: !!parentId,
          parentId,
          extent,
          payloadParentId: payload.parentId,
          dataParentId: payload.data?.parentId,
        })

        await dbOrTx.insert(workflowBlocks).values({
          id: payload.id,
          workflowId,
          type: payload.type,
          name: payload.name,
          positionX: payload.position.x,
          positionY: payload.position.y,
          data: payload.data || {},
          parentId,
          extent,
          enabled: true, // Default to enabled
        })

        // Auto-create subflow entry for loop/parallel blocks
        if (isSubflowBlockType(payload.type)) {
          try {
            const subflowConfig =
              payload.type === SubflowType.LOOP
                ? {
                    id: payload.id,
                    nodes: [], // Empty initially, will be populated when child blocks are added
                    iterations: payload.data?.count || DEFAULT_LOOP_ITERATIONS,
                    loopType: payload.data?.loopType || 'for',
                    forEachItems: payload.data?.collection || '',
                  }
                : {
                    id: payload.id,
                    nodes: [], // Empty initially, will be populated when child blocks are added
                    distribution: payload.data?.collection || '',
                  }

            logger.debug(
              `[SERVER] Auto-creating ${payload.type} subflow ${payload.id}:`,
              subflowConfig
            )

            await dbOrTx.insert(workflowSubflows).values({
              id: payload.id,
              workflowId,
              type: payload.type,
              config: subflowConfig,
            })

            logger.debug(`[SERVER] ✅ Successfully created ${payload.type} subflow ${payload.id}`)
          } catch (subflowError) {
            logger.error(
              `[SERVER] ❌ Failed to create ${payload.type} subflow ${payload.id}:`,
              subflowError
            )
            throw subflowError
          }
        }

        // If this block has a parent, update the parent's subflow node list
        if (parentId) {
          await updateSubflowNodeList(dbOrTx, workflowId, parentId)
        }

        logger.debug(`Added block ${payload.id} (${payload.type}) to workflow ${workflowId}`)
        break
      }

      case 'update-position': {
        if (!payload.id || !payload.position) {
          throw new Error('Missing required fields for update position operation')
        }

        const updateResult = await dbOrTx
          .update(workflowBlocks)
          .set({
            positionX: payload.position.x,
            positionY: payload.position.y,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
          .returning({ id: workflowBlocks.id })

        if (updateResult.length === 0) {
          throw new Error(`Block ${payload.id} not found in workflow ${workflowId}`)
        }
        break
      }

      case 'update-name':
        if (!payload.id || !payload.name) {
          throw new Error('Missing required fields for update name operation')
        }

        await db
          .update(workflowBlocks)
          .set({
            name: payload.name,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        break

      case 'update-parent': {
        if (!payload.id) {
          throw new Error('Missing block ID for update parent operation')
        }

        // Get the current parent before updating
        const currentBlock = await dbOrTx
          .select({ parentId: workflowBlocks.parentId })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        const oldParentId = currentBlock.length > 0 ? currentBlock[0].parentId : null

        await dbOrTx
          .update(workflowBlocks)
          .set({
            parentId: payload.parentId || null,
            extent: payload.extent || null,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))

        // Update subflow node lists for both old and new parents
        if (oldParentId) {
          await updateSubflowNodeList(dbOrTx, workflowId, oldParentId)
        }
        if (payload.parentId && payload.parentId !== oldParentId) {
          await updateSubflowNodeList(dbOrTx, workflowId, payload.parentId)
        }
        break
      }

      case 'remove': {
        if (!payload.id) {
          throw new Error('Missing block ID for remove operation')
        }

        // Check if this is a subflow block that needs cascade deletion
        const blockToRemove = await dbOrTx
          .select({ type: workflowBlocks.type, parentId: workflowBlocks.parentId })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        if (blockToRemove.length > 0 && isSubflowBlockType(blockToRemove[0].type)) {
          // Cascade delete: Remove all child blocks first
          const childBlocks = await dbOrTx
            .select({ id: workflowBlocks.id, type: workflowBlocks.type })
            .from(workflowBlocks)
            .where(
              and(
                eq(workflowBlocks.workflowId, workflowId),
                eq(workflowBlocks.parentId, payload.id)
              )
            )

          logger.debug(
            `[SERVER] Starting cascade deletion for subflow block ${payload.id} (type: ${blockToRemove[0].type})`
          )
          logger.debug(
            `[SERVER] Found ${childBlocks.length} child blocks to delete: [${childBlocks.map((b) => `${b.id} (${b.type})`).join(', ')}]`
          )

          // Remove edges connected to child blocks
          for (const childBlock of childBlocks) {
            await dbOrTx
              .delete(workflowEdges)
              .where(
                and(
                  eq(workflowEdges.workflowId, workflowId),
                  or(
                    eq(workflowEdges.sourceBlockId, childBlock.id),
                    eq(workflowEdges.targetBlockId, childBlock.id)
                  )
                )
              )
          }

          // Remove child blocks from database
          await dbOrTx
            .delete(workflowBlocks)
            .where(
              and(
                eq(workflowBlocks.workflowId, workflowId),
                eq(workflowBlocks.parentId, payload.id)
              )
            )

          // Remove the subflow entry
          await dbOrTx
            .delete(workflowSubflows)
            .where(
              and(eq(workflowSubflows.id, payload.id), eq(workflowSubflows.workflowId, workflowId))
            )

          logger.debug(
            `[SERVER] ✅ Cascade deleted ${childBlocks.length} child blocks and subflow ${payload.id}`
          )
        }

        // Remove any edges connected to this block
        await dbOrTx
          .delete(workflowEdges)
          .where(
            and(
              eq(workflowEdges.workflowId, workflowId),
              or(
                eq(workflowEdges.sourceBlockId, payload.id),
                eq(workflowEdges.targetBlockId, payload.id)
              )
            )
          )

        // Finally remove the block itself
        await dbOrTx
          .delete(workflowBlocks)
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))

        // If this block had a parent, update the parent's subflow node list
        if (blockToRemove.length > 0 && blockToRemove[0].parentId) {
          await updateSubflowNodeList(dbOrTx, workflowId, blockToRemove[0].parentId)
        }

        logger.debug(`Removed block ${payload.id} and its connections from workflow ${workflowId}`)
        break
      }

      case 'toggle-enabled':
        if (!payload.id || payload.enabled === undefined) {
          throw new Error('Missing required fields for toggle enabled operation')
        }

        await db
          .update(workflowBlocks)
          .set({
            enabled: payload.enabled,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
        break

      case 'duplicate': {
        if (!payload.id || !payload.newId || !payload.position) {
          throw new Error('Missing required fields for duplicate operation')
        }

        // Get the original block
        const originalBlock = await db
          .select()
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, payload.id), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        if (originalBlock.length === 0) {
          throw new Error(`Original block ${payload.id} not found`)
        }

        // Create duplicate with new ID and position
        await db.insert(workflowBlocks).values({
          ...originalBlock[0],
          id: payload.newId,
          name: `${originalBlock[0].name} (Copy)`,
          positionX: payload.position.x,
          positionY: payload.position.y,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        break
      }

      default:
        logger.warn(`Unknown block operation: ${operation}`)
        throw new Error(`Unsupported block operation: ${operation}`)
    }
  } catch (error) {
    logger.error(`Error in handleBlockOperation (${operation}):`, error)
    throw error
  }
}

async function handleEdgeOperation(
  workflowId: string,
  operation: string,
  payload: any,
  userId: string
) {
  try {
    switch (operation) {
      case 'add': {
        // Validate required fields
        if (!payload.id || !payload.source || !payload.target) {
          throw new Error('Missing required fields for add edge operation')
        }

        // Check if source and target blocks exist
        const sourceBlock = await db
          .select({ id: workflowBlocks.id })
          .from(workflowBlocks)
          .where(
            and(eq(workflowBlocks.id, payload.source), eq(workflowBlocks.workflowId, workflowId))
          )
          .limit(1)

        const targetBlock = await db
          .select({ id: workflowBlocks.id })
          .from(workflowBlocks)
          .where(
            and(eq(workflowBlocks.id, payload.target), eq(workflowBlocks.workflowId, workflowId))
          )
          .limit(1)

        if (sourceBlock.length === 0) {
          // For new workflows, blocks might not be persisted yet - log warning but don't fail
          logger.warn(
            `Source block ${payload.source} not found in database - may be a new workflow`
          )
          throw new Error(`Source block ${payload.source} not found`)
        }
        if (targetBlock.length === 0) {
          logger.warn(
            `Target block ${payload.target} not found in database - may be a new workflow`
          )
          throw new Error(`Target block ${payload.target} not found`)
        }

        // Check for duplicate edges
        const existingEdge = await db
          .select({ id: workflowEdges.id })
          .from(workflowEdges)
          .where(
            and(
              eq(workflowEdges.workflowId, workflowId),
              eq(workflowEdges.sourceBlockId, payload.source),
              eq(workflowEdges.targetBlockId, payload.target),
              eq(workflowEdges.sourceHandle, payload.sourceHandle || ''),
              eq(workflowEdges.targetHandle, payload.targetHandle || '')
            )
          )
          .limit(1)

        if (existingEdge.length > 0) {
          logger.warn(`Duplicate edge detected: ${payload.source} -> ${payload.target}`)
          return // Skip duplicate edge creation
        }

        await db.insert(workflowEdges).values({
          id: payload.id,
          workflowId,
          sourceBlockId: payload.source,
          targetBlockId: payload.target,
          sourceHandle: payload.sourceHandle || null,
          targetHandle: payload.targetHandle || null,
        })

        logger.debug(`Added edge ${payload.id}: ${payload.source} -> ${payload.target}`)
        break
      }

      case 'remove': {
        if (!payload.id) {
          throw new Error('Missing edge ID for remove operation')
        }

        const deleteResult = await db
          .delete(workflowEdges)
          .where(and(eq(workflowEdges.id, payload.id), eq(workflowEdges.workflowId, workflowId)))
          .returning({ id: workflowEdges.id })

        if (deleteResult.length === 0) {
          throw new Error(`Edge ${payload.id} not found in workflow ${workflowId}`)
        }

        logger.debug(`Removed edge ${payload.id} from workflow ${workflowId}`)
        break
      }

      default:
        logger.warn(`Unknown edge operation: ${operation}`)
        throw new Error(`Unsupported edge operation: ${operation}`)
    }
  } catch (error) {
    logger.error(`Error in handleEdgeOperation (${operation}):`, error)
    throw error
  }
}

// Global error handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error)
  // Don't exit in production, just log
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

// Socket server error handling
httpServer.on('error', (error) => {
  logger.error('HTTP server error:', error)
})

io.engine.on('connection_error', (err) => {
  logger.error('Socket.IO connection error:', {
    req: err.req?.url,
    code: err.code,
    message: err.message,
    context: err.context,
  })
})

io.on('connection', (socket: AuthenticatedSocket) => {
  logger.info(`✅ Socket.IO user connected: ${socket.id}`, {
    transport: socket.conn.transport.name,
    remoteAddress: socket.conn.remoteAddress,
    userId: socket.userId,
    userName: socket.userName,
  })

  // Set up error handling for this socket
  socket.on('error', (error) => {
    logger.error(`Socket ${socket.id} error:`, error)
  })

  socket.conn.on('error', (error) => {
    logger.error(`Socket ${socket.id} connection error:`, error)
  })

  // Handle joining a workflow room with enhanced authentication
  socket.on('join-workflow', async ({ workflowId }) => {
    try {
      // Use authenticated user info from socket
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        logger.warn(`Join workflow rejected: Socket ${socket.id} not authenticated`)
        socket.emit('join-workflow-error', { error: 'Authentication required' })
        return
      }

      logger.info(`Join workflow request from ${userId} (${userName}) for workflow ${workflowId}`)

      // Verify workflow access
      try {
        const accessInfo = await verifyWorkflowAccess(userId, workflowId)
        if (!accessInfo.hasAccess) {
          logger.warn(`User ${userId} (${userName}) denied access to workflow ${workflowId}`)
          socket.emit('join-workflow-error', { error: 'Access denied to workflow' })
          return
        }
      } catch (error) {
        logger.warn(`Error verifying workflow access for ${userId}:`, error)
        socket.emit('join-workflow-error', { error: 'Failed to verify workflow access' })
        return
      }

      // Leave any previous workflow room
      const currentWorkflowId = socketToWorkflow.get(socket.id)
      if (currentWorkflowId) {
        socket.leave(currentWorkflowId)
        cleanupUserFromRoom(socket.id, currentWorkflowId)

        // Notify previous room about user leaving
        socket.to(currentWorkflowId).emit('user-left', {
          userId,
          socketId: socket.id,
        })
      }

      // Join the new workflow room
      socket.join(workflowId)

      // Create or get workflow room
      if (!workflowRooms.has(workflowId)) {
        workflowRooms.set(workflowId, createWorkflowRoom(workflowId))
      }

      const room = workflowRooms.get(workflowId)!
      room.activeConnections++

      // Store user presence
      const userPresence: UserPresence = {
        userId,
        workflowId,
        userName,
        socketId: socket.id,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
      }

      room.users.set(socket.id, userPresence)
      socketToWorkflow.set(socket.id, workflowId)
      userSessions.set(socket.id, { userId, userName })

      // Get current room presence for the new user
      const roomPresence = Array.from(room.users.values())

      // Send current workflow state and presence to the new user
      const workflowState = await getWorkflowState(workflowId)
      socket.emit('workflow-state', workflowState)
      socket.emit('presence-update', roomPresence)

      // Notify others in the room about new user
      socket.to(workflowId).emit('user-joined', {
        userId,
        userName,
        socketId: socket.id,
      })

      logger.info(
        `User ${userId} (${userName}) joined workflow ${workflowId}. Room now has ${room.activeConnections} users.`
      )
    } catch (error) {
      logger.error('Error joining workflow:', error)
      socket.emit('error', {
        type: 'JOIN_ERROR',
        message: 'Failed to join workflow',
      })
    }
  })

  // Handle workflow operations (blocks, edges, subflows) with enhanced validation and conflict resolution
  socket.on('workflow-operation', async (data) => {
    const workflowId = socketToWorkflow.get(socket.id)
    const session = userSessions.get(socket.id)

    if (!workflowId || !session) {
      socket.emit('error', {
        type: 'NOT_JOINED',
        message: 'Not joined to any workflow',
      })
      return
    }

    const room = workflowRooms.get(workflowId)
    if (!room) {
      socket.emit('error', {
        type: 'ROOM_NOT_FOUND',
        message: 'Workflow room not found',
      })
      return
    }

    try {
      // Validate operation schema
      const validatedOperation = WorkflowOperationSchema.parse(data)
      const { operation, target, payload, timestamp } = validatedOperation

      // Check if operation should be accepted (simplified conflict resolution)
      if (!shouldAcceptOperation(validatedOperation, room.lastModified)) {
        socket.emit('operation-rejected', {
          type: 'OPERATION_REJECTED',
          message: 'Operation rejected',
          operation,
          target,
          serverTimestamp: Date.now(),
        })
        return
      }

      // Check operation permissions (temporarily bypassed for testing)
      const permissionCheck = await verifyOperationPermission(
        session.userId,
        workflowId,
        operation,
        target
      )
      if (!permissionCheck.allowed) {
        logger.warn(
          `User ${session.userId} forbidden from ${operation} on ${target}: ${permissionCheck.reason}`
        )
        socket.emit('operation-forbidden', {
          type: 'INSUFFICIENT_PERMISSIONS',
          message: permissionCheck.reason || 'Insufficient permissions for this operation',
          operation,
          target,
        })
        return
      }

      // Update user activity
      const userPresence = room.users.get(socket.id)
      if (userPresence) {
        userPresence.lastActivity = Date.now()
      }

      // Persist to database with transaction (last-write-wins)
      const serverTimestamp = Date.now()
      await persistWorkflowOperation(workflowId, {
        operation,
        target,
        payload,
        timestamp: serverTimestamp, // Use server timestamp for consistency
        userId: session.userId,
      })

      // Update room's last modified timestamp
      room.lastModified = serverTimestamp

      // Broadcast to all other clients in the room (excluding sender)
      const broadcastData = {
        operation,
        target,
        payload,
        timestamp: serverTimestamp,
        senderId: socket.id,
        userId: session.userId,
        userName: session.userName,
        // Add operation metadata for better client handling
        metadata: {
          workflowId,
          operationId: crypto.randomUUID(), // Unique operation ID for tracking
        },
      }

      socket.to(workflowId).emit('workflow-operation', broadcastData)

      // Send confirmation back to sender with operation ID for tracking
      socket.emit('operation-confirmed', {
        operation,
        target,
        operationId: broadcastData.metadata.operationId,
        serverTimestamp,
      })

      logger.info(
        `✅ Operation ${operation} on ${target} in workflow ${workflowId} by user ${session.userId} (${session.userName})`
      )
    } catch (error) {
      if (error instanceof z.ZodError) {
        socket.emit('operation-error', {
          type: 'VALIDATION_ERROR',
          message: 'Invalid operation data',
          errors: error.errors,
          operation: data.operation,
          target: data.target,
        })
        logger.warn(`Validation error for operation from ${session.userId}:`, error.errors)
      } else if (error instanceof Error) {
        // Handle specific database errors
        if (error.message.includes('not found')) {
          socket.emit('operation-error', {
            type: 'RESOURCE_NOT_FOUND',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        } else if (error.message.includes('duplicate') || error.message.includes('unique')) {
          socket.emit('operation-error', {
            type: 'DUPLICATE_RESOURCE',
            message: 'Resource already exists',
            operation: data.operation,
            target: data.target,
          })
        } else {
          socket.emit('operation-error', {
            type: 'OPERATION_FAILED',
            message: error.message,
            operation: data.operation,
            target: data.target,
          })
        }
        logger.error(
          `Operation error for ${session.userId} (${data.operation} on ${data.target}):`,
          error
        )
      } else {
        socket.emit('operation-error', {
          type: 'UNKNOWN_ERROR',
          message: 'An unknown error occurred',
          operation: data.operation,
          target: data.target,
        })
        logger.error('Unknown error handling workflow operation:', error)
      }
    }
  })

  // Handle subblock value updates
  socket.on('subblock-update', async (data) => {
    const workflowId = socketToWorkflow.get(socket.id)
    const session = userSessions.get(socket.id)

    if (!workflowId || !session) {
      logger.debug(`Ignoring subblock update: socket not connected to any workflow room`, {
        socketId: socket.id,
        hasWorkflowId: !!workflowId,
        hasSession: !!session,
      })
      return
    }

    const { blockId, subblockId, value, timestamp } = data
    const room = workflowRooms.get(workflowId)

    if (!room) {
      logger.debug(`Ignoring subblock update: workflow room not found`, {
        socketId: socket.id,
        workflowId,
        blockId,
        subblockId,
      })
      return
    }

    try {
      // Update user activity
      const userPresence = room.users.get(socket.id)
      if (userPresence) {
        userPresence.lastActivity = Date.now()
      }

      // First, verify that the workflow still exists in the database
      const workflowExists = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (workflowExists.length === 0) {
        logger.warn(`Ignoring subblock update: workflow ${workflowId} no longer exists`, {
          socketId: socket.id,
          blockId,
          subblockId,
        })
        // Clean up the socket from this non-existent workflow
        cleanupUserFromRoom(socket.id, workflowId)
        return
      }

      // Persist subblock update to database
      await db.transaction(async (tx) => {
        // Get the current block subBlocks data
        const [block] = await tx
          .select({ subBlocks: workflowBlocks.subBlocks })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)

        if (!block) {
          throw new Error(`Block ${blockId} not found in workflow ${workflowId}`)
        }

        // Parse the current subBlocks data
        const subBlocks = (block.subBlocks as any) || {}

        // Update the subblock value in the subBlocks data
        if (!subBlocks[subblockId]) {
          subBlocks[subblockId] = {}
        }
        subBlocks[subblockId].value = value

        // Save the updated subBlocks data back to the database
        await tx
          .update(workflowBlocks)
          .set({
            subBlocks: subBlocks,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))

        logger.debug(
          `✅ Persisted subblock update: ${workflowId}/${blockId}.${subblockId} = ${JSON.stringify(value)}`
        )
      })

      // Broadcast to other clients after successful persistence
      socket.to(workflowId).emit('subblock-update', {
        blockId,
        subblockId,
        value,
        timestamp,
        senderId: socket.id,
        userId: session.userId,
      })

      logger.debug(`Subblock update in workflow ${workflowId}: ${blockId}.${subblockId}`)
    } catch (error) {
      logger.error('Error handling subblock update:', error)

      // Send error back to client
      socket.emit('operation-error', {
        type: 'SUBBLOCK_UPDATE_FAILED',
        message: `Failed to update subblock ${blockId}.${subblockId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        operation: 'subblock-update',
        target: 'subblock',
      })
    }
  })

  // Handle cursor/presence updates
  socket.on('cursor-update', ({ cursor }) => {
    const workflowId = socketToWorkflow.get(socket.id)
    const session = userSessions.get(socket.id)

    if (!workflowId || !session) return

    const room = workflowRooms.get(workflowId)
    if (!room) return

    // Update stored cursor position
    const userPresence = room.users.get(socket.id)
    if (userPresence) {
      userPresence.cursor = cursor
      userPresence.lastActivity = Date.now()
    }

    // Broadcast cursor position to others in the room
    socket.to(workflowId).emit('cursor-update', {
      socketId: socket.id,
      userId: session.userId,
      userName: session.userName,
      cursor,
    })
  })

  // Handle user selection (for showing what block/element a user has selected)
  socket.on('selection-update', ({ selection }) => {
    const workflowId = socketToWorkflow.get(socket.id)
    const session = userSessions.get(socket.id)

    if (!workflowId || !session) return

    const room = workflowRooms.get(workflowId)
    if (!room) return

    // Update stored selection
    const userPresence = room.users.get(socket.id)
    if (userPresence) {
      userPresence.selection = selection
      userPresence.lastActivity = Date.now()
    }

    socket.to(workflowId).emit('selection-update', {
      socketId: socket.id,
      userId: session.userId,
      userName: session.userName,
      selection, // { type: 'block' | 'edge' | 'none', id?: string }
    })
  })

  // Handle disconnect with enhanced cleanup and recovery
  socket.on('disconnect', (reason) => {
    const workflowId = socketToWorkflow.get(socket.id)
    const session = userSessions.get(socket.id)

    logger.info(`Socket ${socket.id} disconnected: ${reason}`)

    if (workflowId && session) {
      // Clean up user from room
      cleanupUserFromRoom(socket.id, workflowId)

      // Notify others in the room
      socket.to(workflowId).emit('user-left', {
        userId: session.userId,
        socketId: socket.id,
        reason: reason,
      })

      logger.info(
        `User ${session.userId} (${session.userName}) disconnected from workflow ${workflowId} - reason: ${reason}`
      )
    }

    // Clear any pending operations for this socket
    clearPendingOperations(socket.id)
  })

  // Handle connection errors
  socket.on('error', (error) => {
    logger.error(`Socket ${socket.id} error:`, error)
    const session = userSessions.get(socket.id)
    if (session) {
      logger.error(`Error for user ${session.userId} (${session.userName}):`, error)
    }
  })

  // Handle ping/pong for connection health
  socket.on('ping', () => {
    socket.emit('pong')
  })

  // Handle manual reconnection requests
  socket.on('request-sync', async ({ workflowId }) => {
    try {
      if (!socket.userId) {
        socket.emit('error', { type: 'NOT_AUTHENTICATED', message: 'Not authenticated' })
        return
      }

      const accessInfo = await verifyWorkflowAccess(socket.userId, workflowId)
      if (!accessInfo.hasAccess) {
        socket.emit('error', { type: 'ACCESS_DENIED', message: 'Access denied' })
        return
      }

      // Send current workflow state
      const workflowState = await getWorkflowState(workflowId)
      socket.emit('workflow-state', workflowState)

      logger.info(`Sent sync data to ${socket.userId} for workflow ${workflowId}`)
    } catch (error) {
      logger.error('Error handling sync request:', error)
      socket.emit('error', { type: 'SYNC_FAILED', message: 'Failed to sync workflow state' })
    }
  })

  // Handle explicit leave workflow
  socket.on('leave-workflow', () => {
    const workflowId = socketToWorkflow.get(socket.id)
    const session = userSessions.get(socket.id)

    if (workflowId && session) {
      socket.leave(workflowId)
      cleanupUserFromRoom(socket.id, workflowId)

      socket.to(workflowId).emit('user-left', {
        userId: session.userId,
        socketId: socket.id,
      })

      logger.info(`User ${session.userId} (${session.userName}) left workflow ${workflowId}`)
    }
  })
})

// Add detailed request logging
httpServer.on('request', (req, res) => {
  logger.info(`🌐 HTTP Request: ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin,
    host: req.headers.host,
    timestamp: new Date().toISOString(),
  })
})

// Enhanced connection logging
io.engine.on('connection_error', (err) => {
  logger.error('❌ Engine.IO Connection error:', {
    code: err.code,
    message: err.message,
    context: err.context,
    req: err.req
      ? {
          url: err.req.url,
          method: err.req.method,
          headers: err.req.headers,
        }
      : 'No request object',
  })
})

// Start the server
const PORT = Number(process.env.PORT || process.env.SOCKET_PORT || 3002)

logger.info('Starting Socket.IO server...', {
  port: PORT,
  nodeEnv: process.env.NODE_ENV,
  hasDatabase: !!process.env.DATABASE_URL,
  hasAuth: !!process.env.BETTER_AUTH_SECRET,
})

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`✅ Socket.IO server running on port ${PORT}`)
  logger.info(`🏥 Health check available at: http://localhost:${PORT}/health`)
})

httpServer.on('error', (error) => {
  logger.error('❌ Server failed to start:', error)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down Socket.IO server...')
  httpServer.close(() => {
    logger.info('Socket.IO server closed')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  logger.info('Shutting down Socket.IO server...')
  httpServer.close(() => {
    logger.info('Socket.IO server closed')
    process.exit(0)
  })
})
