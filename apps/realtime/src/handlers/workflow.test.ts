/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager } from '@/rooms'

const {
  mockGetWorkflowState,
  mockVerifyWorkflowAccess,
  mockResolveCurrentWorkflowRole,
  mockResolveAvatarUrl,
} = vi.hoisted(() => ({
  mockGetWorkflowState: vi.fn(),
  mockVerifyWorkflowAccess: vi.fn(),
  mockResolveCurrentWorkflowRole: vi.fn(),
  mockResolveAvatarUrl: vi.fn(),
}))

vi.mock('@/handlers/avatar', () => ({
  resolveAvatarUrl: mockResolveAvatarUrl,
}))

vi.mock('@sim/db', () => ({
  db: { select: vi.fn() },
  user: { image: 'image' },
}))

vi.mock('@/database/operations', () => ({
  getWorkflowState: mockGetWorkflowState,
}))

vi.mock('@/middleware/permissions', () => ({
  verifyWorkflowAccess: mockVerifyWorkflowAccess,
  resolveCurrentWorkflowRole: mockResolveCurrentWorkflowRole,
}))

import { setupWorkflowHandlers } from '@/handlers/workflow'

interface JoinWorkflowPayload {
  workflowId: string
  tabSessionId?: string
}

function createSocket(overrides?: Partial<Record<string, unknown>>) {
  // leave-workflow takes no payload; join-workflow takes one — so the stored handler's arg is optional.
  const handlers: Record<string, (payload?: JoinWorkflowPayload) => Promise<void> | void> = {}
  const socket = {
    id: 'socket-1',
    userId: 'user-1',
    userName: 'Test User',
    userImage: 'avatar.png',
    on: vi.fn((event: string, handler: (payload?: JoinWorkflowPayload) => Promise<void> | void) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    ...overrides,
  }

  return {
    handlers,
    socket,
  }
}

function createRoomManager(overrides?: Partial<IRoomManager>): IRoomManager {
  return {
    isReady: vi.fn().mockReturnValue(true),
    getRoomForSocket: vi.fn().mockResolvedValue(null),
    getRoomsForSocket: vi.fn().mockResolvedValue([]),
    removeUserFromRoom: vi.fn().mockResolvedValue(false),
    removeSocketFromAllRooms: vi.fn().mockResolvedValue([]),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    getRoomUsers: vi.fn().mockResolvedValue([]),
    hasRoom: vi.fn().mockResolvedValue(false),
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    addUserToRoom: vi.fn().mockResolvedValue(undefined),
    getUserSession: vi.fn().mockResolvedValue(null),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
    updateRoomLastModified: vi.fn().mockResolvedValue(undefined),
    emitToRoom: vi.fn(),
    getUniqueUserCount: vi.fn().mockResolvedValue(1),
    getTotalActiveConnections: vi.fn().mockResolvedValue(0),
    shutdown: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    io: {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockResolvedValue([]),
        socketsLeave: vi.fn().mockResolvedValue(undefined),
      }),
    },
    ...overrides,
  } as unknown as IRoomManager
}

describe('setupWorkflowHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkflowState.mockResolvedValue({ id: 'workflow-1', state: {} })
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true, role: 'admin' })
    mockResolveCurrentWorkflowRole.mockResolvedValue('admin')
    mockResolveAvatarUrl.mockResolvedValue('avatar.png')
  })

  it('resolves the avatar before joining so no await sits between socket.join and addUserToRoom', async () => {
    const order: string[] = []
    mockResolveAvatarUrl.mockImplementation(async () => {
      order.push('avatar')
      return 'avatar.png'
    })
    const { socket, handlers } = createSocket({
      join: vi.fn(() => {
        order.push('join')
      }),
    })
    const roomManager = createRoomManager({
      addUserToRoom: vi.fn(async () => {
        order.push('add')
      }),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    // The avatar await must complete before socket.join; reintroducing it between
    // join and addUserToRoom reopens the revoke-race ghost-presence window.
    expect(order).toEqual(['avatar', 'join', 'add'])
  })

  it('includes workflowId when authentication is missing', async () => {
    const { socket, handlers } = createSocket({ userId: undefined, userName: undefined })
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED',
      retryable: false,
    })
  })

  it('includes workflowId when realtime is unavailable', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      isReady: vi.fn().mockReturnValue(false),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Realtime unavailable',
      code: 'ROOM_MANAGER_UNAVAILABLE',
      retryable: true,
    })
  })

  it('includes workflowId when access is denied', async () => {
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: false })

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Access denied to workflow',
      code: 'ACCESS_DENIED',
      retryable: false,
    })
  })

  it('denies the join when access is revoked while the join is in flight', async () => {
    mockResolveCurrentWorkflowRole.mockResolvedValue(null)

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Access denied to workflow',
      code: 'ACCESS_DENIED',
      retryable: false,
    })
    expect(socket.join).not.toHaveBeenCalled()
    expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
  })

  it('joins with the re-validated role, passing the join-time role as fallback', async () => {
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true, role: 'write' })
    mockResolveCurrentWorkflowRole.mockResolvedValue('read')

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(mockResolveCurrentWorkflowRole).toHaveBeenCalledWith('user-1', 'workflow-1', 'write')
    expect(socket.join).toHaveBeenCalledWith('workflow-1')
    expect(roomManager.addUserToRoom).toHaveBeenCalledWith(
      { type: 'workflow', id: 'workflow-1' },
      'socket-1',
      expect.objectContaining({ role: 'read' })
    )
  })

  it('marks workflow access verification failures as retryable', async () => {
    mockVerifyWorkflowAccess.mockRejectedValue(new Error('database unavailable'))

    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Failed to verify workflow access',
      code: 'VERIFY_WORKFLOW_ACCESS_FAILED',
      retryable: true,
    })
  })

  it('includes workflowId when an unexpected join failure occurs', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      getRoomForSocket: vi.fn().mockRejectedValue(new Error('boom')),
      removeUserFromRoom: vi.fn().mockResolvedValue(false),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).toHaveBeenCalledWith('join-workflow-error', {
      workflowId: 'workflow-1',
      error: 'Failed to join workflow',
      code: 'JOIN_WORKFLOW_FAILED',
      retryable: true,
    })
  })

  it('cancels a superseded queued join on a fast workflow switch', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    // Enqueue A without awaiting, then B: B bumps the generation synchronously, so A is superseded
    // before its queued op runs and must never commit.
    handlers['join-workflow']({ workflowId: 'workflow-a', tabSessionId: 'tab-1' })
    await handlers['join-workflow']({ workflowId: 'workflow-b', tabSessionId: 'tab-1' })

    expect(socket.join).toHaveBeenCalledWith('workflow-b')
    expect(socket.join).not.toHaveBeenCalledWith('workflow-a')
    expect(roomManager.addUserToRoom).toHaveBeenCalledWith(
      { type: 'workflow', id: 'workflow-b' },
      'socket-1',
      expect.anything()
    )
    expect(roomManager.addUserToRoom).not.toHaveBeenCalledWith(
      { type: 'workflow', id: 'workflow-a' },
      'socket-1',
      expect.anything()
    )
  })

  it('cancels an in-flight join when a leave is enqueued before it commits', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })
    await handlers['leave-workflow']()

    expect(socket.join).not.toHaveBeenCalled()
    expect(roomManager.addUserToRoom).not.toHaveBeenCalled()
  })

  it('rolls back the workflow membership when addUserToRoom fails mid-commit', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      addUserToRoom: vi.fn().mockRejectedValue(new Error('redis down')),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.leave).toHaveBeenCalledWith('workflow-1')
    expect(roomManager.removeUserFromRoom).toHaveBeenCalledWith(
      { type: 'workflow', id: 'workflow-1' },
      'socket-1'
    )
    expect(socket.emit).toHaveBeenCalledWith(
      'join-workflow-error',
      expect.objectContaining({ code: 'JOIN_WORKFLOW_FAILED' })
    )
  })

  it('does not roll back a committed join when a post-success step fails', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      // Trailing broadcast (post-addUserToRoom, post-success-ack) fails on a Redis blip.
      broadcastPresenceUpdate: vi.fn().mockRejectedValue(new Error('redis blip')),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    // The user is genuinely joined and was acked; the trailing failure must NOT tear them out.
    expect(socket.emit).toHaveBeenCalledWith(
      'join-workflow-success',
      expect.objectContaining({ workflowId: 'workflow-1' })
    )
    expect(socket.leave).not.toHaveBeenCalled()
    expect(roomManager.removeUserFromRoom).not.toHaveBeenCalled()
    expect(socket.emit).not.toHaveBeenCalledWith('join-workflow-error', expect.anything())
  })

  it('rolls back and surfaces a retryable error when a pre-success step fails after commit', async () => {
    // getWorkflowState runs after addUserToRoom but before the success ack — its failure must roll
    // back and emit a retryable error so the client retries, never hanging committed-but-unacked.
    mockGetWorkflowState.mockRejectedValue(new Error('db blip'))
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager()

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['join-workflow']({ workflowId: 'workflow-1', tabSessionId: 'tab-1' })

    expect(socket.emit).not.toHaveBeenCalledWith('join-workflow-success', expect.anything())
    expect(roomManager.removeUserFromRoom).toHaveBeenCalledWith(
      { type: 'workflow', id: 'workflow-1' },
      'socket-1'
    )
    expect(socket.emit).toHaveBeenCalledWith(
      'join-workflow-error',
      expect.objectContaining({ code: 'JOIN_WORKFLOW_FAILED', retryable: true })
    )
  })

  it('leaves the workflow room even when the session key has expired', async () => {
    const { socket, handlers } = createSocket()
    const roomManager = createRoomManager({
      getRoomForSocket: vi.fn().mockResolvedValue({ type: 'workflow', id: 'workflow-1' }),
      getUserSession: vi.fn().mockResolvedValue(null),
    })

    setupWorkflowHandlers(
      socket as unknown as Parameters<typeof setupWorkflowHandlers>[0],
      roomManager
    )

    await handlers['leave-workflow']()

    expect(socket.leave).toHaveBeenCalledWith('workflow-1')
    expect(roomManager.removeUserFromRoom).toHaveBeenCalledWith(
      { type: 'workflow', id: 'workflow-1' },
      'socket-1'
    )
    expect(roomManager.broadcastPresenceUpdate).toHaveBeenCalledWith({
      type: 'workflow',
      id: 'workflow-1',
    })
  })
})
