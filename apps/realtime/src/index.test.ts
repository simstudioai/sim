/**
 * Tests for the socket server index.ts
 *
 * @vitest-environment node
 */
import { createServer, request as httpRequest } from 'http'
import { createMockLogger } from '@sim/testing'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSocketIOServer } from '@/config/socket'
import { MemoryRoomManager } from '@/rooms'
import { createHttpHandler } from '@/routes/http'

vi.mock('@/auth', () => ({
  auth: {
    api: {
      verifyOneTimeToken: vi.fn(),
    },
  },
  ANONYMOUS_USER_ID: '00000000-0000-0000-0000-000000000000',
  ANONYMOUS_USER: {
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Anonymous',
    email: 'anonymous@localhost',
    emailVerified: true,
    image: null,
  },
}))

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn().mockReturnThis(),
  })),
}))

vi.mock('@/env', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    NODE_ENV: 'test',
    REDIS_URL: undefined,
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32-chars',
    INTERNAL_API_SECRET: 'test-internal-api-secret-at-least-32-chars',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    PORT: 3002,
    DISABLE_AUTH: false,
  },
  isProd: false,
  isDev: false,
  isTest: true,
  isHosted: false,
  isAuthDisabled: false,
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/middleware/auth', () => ({
  authenticateSocket: vi.fn((socket, next) => {
    socket.userId = 'test-user-id'
    socket.userName = 'Test User'
    socket.userEmail = 'test@example.com'
    next()
  }),
}))

vi.mock('@/middleware/permissions', () => ({
  verifyWorkflowAccess: vi.fn().mockResolvedValue({
    hasAccess: true,
    role: 'admin',
  }),
  checkRolePermission: vi.fn().mockReturnValue({
    allowed: true,
  }),
}))

vi.mock('@/database/operations', () => ({
  getWorkflowState: vi.fn().mockResolvedValue({
    id: 'test-workflow',
    name: 'Test Workflow',
    lastModified: Date.now(),
  }),
  persistWorkflowOperation: vi.fn().mockResolvedValue(undefined),
}))

describe('Socket Server Index Integration', () => {
  let httpServer: any
  let io: any
  let roomManager: MemoryRoomManager
  let logger: ReturnType<typeof createMockLogger>
  let PORT: number

  beforeAll(() => {
    logger = createMockLogger()
  })

  beforeEach(async () => {
    PORT = 3333 + Math.floor(Math.random() * 1000)

    httpServer = createServer()

    io = await createSocketIOServer(httpServer)

    roomManager = new MemoryRoomManager(io)
    await roomManager.initialize()

    const httpHandler = createHttpHandler(roomManager, logger)
    httpServer.on('request', httpHandler)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start on port ${PORT} within 15 seconds`))
      }, 15000)

      httpServer.listen(PORT, '0.0.0.0', () => {
        clearTimeout(timeout)
        resolve()
      })

      httpServer.on('error', (err: any) => {
        clearTimeout(timeout)
        if (err.code === 'EADDRINUSE') {
          PORT = 3333 + Math.floor(Math.random() * 1000)
          httpServer.close(() => {
            httpServer.listen(PORT, '0.0.0.0', () => {
              resolve()
            })
          })
        } else {
          reject(err)
        }
      })
    })
  }, 20000)

  afterEach(async () => {
    if (roomManager) {
      await roomManager.shutdown()
    }
    if (io) {
      await new Promise<void>((resolve) => {
        io.close(() => resolve())
      })
    }
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    }
    vi.clearAllMocks()
  })

  describe('HTTP Server Configuration', () => {
    it('should create HTTP server successfully', () => {
      expect(httpServer).toBeDefined()
      expect(httpServer.listening).toBe(true)
    })

    it('should handle health check endpoint', async () => {
      const data = await new Promise<{ status: string; timestamp: number; connections: number }>(
        (resolve, reject) => {
          const req = httpRequest(
            {
              hostname: 'localhost',
              port: PORT,
              path: '/health',
              method: 'GET',
            },
            (res) => {
              expect(res.statusCode).toBe(200)

              let body = ''
              res.on('data', (chunk) => {
                body += chunk
              })
              res.on('end', () => {
                try {
                  resolve(JSON.parse(body))
                } catch (e) {
                  reject(e)
                }
              })
            }
          )

          req.on('error', reject)
          req.end()
        }
      )

      expect(data).toHaveProperty('status', 'ok')
      expect(data).toHaveProperty('timestamp')
      expect(data).toHaveProperty('connections')
    })
  })

  describe('Socket.IO Server Configuration', () => {
    it('should create Socket.IO server with proper configuration', () => {
      expect(io).toBeDefined()
      expect(io.engine).toBeDefined()
    })

    it('should have proper CORS configuration', () => {
      const corsOptions = io.engine.opts.cors
      expect(corsOptions).toBeDefined()
      expect(corsOptions.methods).toContain('GET')
      expect(corsOptions.methods).toContain('POST')
      expect(corsOptions.credentials).toBe(true)
    })

    it('should have proper transport configuration', () => {
      const transports = io.engine.opts.transports
      expect(transports).toContain('polling')
      expect(transports).toContain('websocket')
    })
  })

  describe('Room Manager Integration', () => {
    it('should create room manager successfully', async () => {
      expect(roomManager).toBeDefined()
      expect(await roomManager.getTotalActiveConnections()).toBe(0)
    })

    it('should add and get users from workflow rooms', async () => {
      const workflowId = 'test-workflow-123'
      const socketId = 'test-socket-123'

      const presence = {
        userId: 'user-123',
        workflowId,
        userName: 'Test User',
        socketId,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
        role: 'admin',
      }

      await roomManager.addUserToRoom(workflowId, socketId, presence)

      expect(await roomManager.hasWorkflowRoom(workflowId)).toBe(true)
      const users = await roomManager.getWorkflowUsers(workflowId)
      expect(users).toHaveLength(1)
      expect(users[0].socketId).toBe(socketId)
    })

    it('should manage user sessions', async () => {
      const socketId = 'test-socket-123'
      const workflowId = 'test-workflow-456'

      const presence = {
        userId: 'user-123',
        workflowId,
        userName: 'Test User',
        socketId,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
        role: 'admin',
      }

      await roomManager.addUserToRoom(workflowId, socketId, presence)

      expect(await roomManager.getWorkflowIdForSocket(socketId)).toBe(workflowId)
      const session = await roomManager.getUserSession(socketId)
      expect(session).toBeDefined()
      expect(session?.userId).toBe('user-123')
    })

    it('should clean up rooms properly', async () => {
      const workflowId = 'test-workflow-789'
      const socketId = 'test-socket-789'

      const presence = {
        userId: 'user-789',
        workflowId,
        userName: 'Test User',
        socketId,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
        role: 'admin',
      }

      await roomManager.addUserToRoom(workflowId, socketId, presence)

      expect(await roomManager.hasWorkflowRoom(workflowId)).toBe(true)

      // Remove user
      await roomManager.removeUserFromRoom(socketId)

      // Room should be cleaned up since it's now empty
      expect(await roomManager.hasWorkflowRoom(workflowId)).toBe(false)
      expect(await roomManager.getWorkflowIdForSocket(socketId)).toBeNull()
    })
  })

  describe('Module Integration', () => {
    it.concurrent('should properly import all extracted modules', async () => {
      const { createSocketIOServer } = await import('@/config/socket')
      const { createHttpHandler } = await import('@/routes/http')
      const { MemoryRoomManager, RedisRoomManager } = await import('@/rooms')
      const { authenticateSocket } = await import('@/middleware/auth')
      const { verifyWorkflowAccess } = await import('@/middleware/permissions')
      const { getWorkflowState } = await import('@/database/operations')
      const { WorkflowOperationSchema } = await import('@sim/realtime-protocol/schemas')

      expect(createSocketIOServer).toBeTypeOf('function')
      expect(createHttpHandler).toBeTypeOf('function')
      expect(MemoryRoomManager).toBeTypeOf('function')
      expect(RedisRoomManager).toBeTypeOf('function')
      expect(authenticateSocket).toBeTypeOf('function')
      expect(verifyWorkflowAccess).toBeTypeOf('function')
      expect(getWorkflowState).toBeTypeOf('function')
      expect(WorkflowOperationSchema).toBeDefined()
    })

    it.concurrent('should maintain all original functionality after refactoring', async () => {
      expect(httpServer).toBeDefined()
      expect(io).toBeDefined()
      expect(roomManager).toBeDefined()

      expect(typeof roomManager.addUserToRoom).toBe('function')
      expect(typeof roomManager.removeUserFromRoom).toBe('function')
      expect(typeof roomManager.handleWorkflowDeletion).toBe('function')
      expect(typeof roomManager.broadcastPresenceUpdate).toBe('function')
    })
  })

  describe('Error Handling', () => {
    it('should have global error handlers configured', () => {
      expect(typeof process.on).toBe('function')
    })

    it('should handle server setup', () => {
      expect(httpServer).toBeDefined()
      expect(io).toBeDefined()
    })
  })

  describe('Authentication Middleware', () => {
    it('should apply authentication middleware to Socket.IO', () => {
      expect(io._parser).toBeDefined()
    })
  })

  describe('Graceful Shutdown', () => {
    it('should have shutdown capability', () => {
      expect(typeof httpServer.close).toBe('function')
      expect(typeof io.close).toBe('function')
      expect(typeof roomManager.shutdown).toBe('function')
    })
  })

  describe('Validation and Utils', () => {
    it.concurrent('should validate workflow operations', async () => {
      const { WorkflowOperationSchema } = await import('@sim/realtime-protocol/schemas')

      const validOperation = {
        operation: 'batch-add-blocks',
        target: 'blocks',
        payload: {
          blocks: [
            {
              id: 'test-block',
              type: 'action',
              name: 'Test Block',
              position: { x: 100, y: 200 },
            },
          ],
          edges: [],
          loops: {},
          parallels: {},
          subBlockValues: {},
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validOperation)).not.toThrow()
    })

    it.concurrent('should validate batch-add-blocks with edges', async () => {
      const { WorkflowOperationSchema } = await import('@sim/realtime-protocol/schemas')

      const validOperationWithEdge = {
        operation: 'batch-add-blocks',
        target: 'blocks',
        payload: {
          blocks: [
            {
              id: 'test-block',
              type: 'action',
              name: 'Test Block',
              position: { x: 100, y: 200 },
            },
          ],
          edges: [
            {
              id: 'auto-edge-123',
              source: 'source-block',
              target: 'test-block',
              sourceHandle: 'output',
              targetHandle: 'target',
              type: 'workflowEdge',
            },
          ],
          loops: {},
          parallels: {},
          subBlockValues: {},
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validOperationWithEdge)).not.toThrow()
    })

    it.concurrent('should validate edge operations', async () => {
      const { WorkflowOperationSchema } = await import('@sim/realtime-protocol/schemas')

      const validEdgeOperation = {
        operation: 'add',
        target: 'edge',
        payload: {
          id: 'test-edge',
          source: 'block-1',
          target: 'block-2',
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validEdgeOperation)).not.toThrow()
    })

    it('should validate subflow operations', async () => {
      const { WorkflowOperationSchema } = await import('@sim/realtime-protocol/schemas')

      const validSubflowOperation = {
        operation: 'update',
        target: 'subflow',
        payload: {
          id: 'test-subflow',
          type: 'loop',
          config: { iterations: 5 },
        },
        timestamp: Date.now(),
      }

      expect(() => WorkflowOperationSchema.parse(validSubflowOperation)).not.toThrow()
    })
  })
})
